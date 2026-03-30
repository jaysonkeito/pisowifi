#!/bin/bash
# ============================================================
# CIT Piso WiFi — Orange Pi One Setup Script
# Run once on the Orange Pi after copying project files.
#
# Usage:
#   chmod +x setup-orangepi.sh
#   sudo ./setup-orangepi.sh
# ============================================================
set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️   $1${NC}"; }
err()  { echo -e "${RED}❌  $1${NC}"; }

PROJECT_DIR="/home/orangepi/pisowifi"
BACKEND_DIR="$PROJECT_DIR/backend"
HARDWARE_DIR="$PROJECT_DIR/hardware"

echo ""
echo "🍊  CIT Piso WiFi — Orange Pi Setup"
echo "════════════════════════════════════"
echo ""

# ── 1. System packages ────────────────────────────────────────
echo "[1/6] Installing system packages..."
apt-get update -qq
apt-get install -y python3 python3-pip curl git 2>/dev/null
ok "System packages installed"

# ── 2. Node.js (if not installed) ────────────────────────────
if ! command -v node &>/dev/null; then
  echo "[2/6] Installing Node.js 18..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt-get install -y nodejs
  ok "Node.js $(node -v) installed"
else
  ok "Node.js $(node -v) already installed"
fi

# ── 3. Python GPIO ────────────────────────────────────────────
echo "[3/6] Installing Python GPIO library..."
pip3 install OPi.GPIO requests --break-system-packages 2>/dev/null || \
pip3 install OPi.GPIO requests
ok "OPi.GPIO + requests installed"

# ── 4. Node.js dependencies ───────────────────────────────────
echo "[4/6] Installing Node.js dependencies..."
cd "$BACKEND_DIR"
npm install --production
ok "npm packages installed"

# ── 5. Create .env if missing ─────────────────────────────────
echo "[5/6] Configuring .env..."
if [ ! -f "$BACKEND_DIR/.env" ]; then
  cat > "$BACKEND_DIR/.env" << 'ENV'
PORT=3000
WIFISOFT_HOST=10.0.0.1
WIFISOFT_USER=admin
WIFISOFT_PASS=admin
NODE_ENV=production
ENV
  ok ".env created"
else
  ok ".env already exists"
fi

# ── 6. Systemd services ───────────────────────────────────────
echo "[6/6] Installing systemd services..."

# Backend service
cat > /etc/systemd/system/pisowifi-backend.service << SERVICE
[Unit]
Description=CIT Piso WiFi Backend
After=network.target

[Service]
Type=simple
User=orangepi
WorkingDirectory=$BACKEND_DIR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE

# GPIO reader service
cat > /etc/systemd/system/pisowifi-gpio.service << SERVICE
[Unit]
Description=CIT Piso WiFi GPIO Coin Reader
After=network.target pisowifi-backend.service

[Service]
Type=simple
User=root
WorkingDirectory=$HARDWARE_DIR
ExecStart=/usr/bin/python3 $HARDWARE_DIR/gpio-reader.py
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable pisowifi-backend pisowifi-gpio
ok "Services installed and enabled"

# ── Start ─────────────────────────────────────────────────────
echo ""
echo "Starting services..."
systemctl restart pisowifi-backend
sleep 2
systemctl restart pisowifi-gpio
sleep 1

# ── Status check ──────────────────────────────────────────────
echo ""
echo "════════════════════════════════════"
ok "Setup complete!"
echo ""

if systemctl is-active --quiet pisowifi-backend; then
  ok "Backend is RUNNING"
else
  err "Backend failed to start — check: sudo journalctl -u pisowifi-backend -n 20"
fi

if systemctl is-active --quiet pisowifi-gpio; then
  ok "GPIO reader is RUNNING"
else
  warn "GPIO reader not started — may need: sudo systemctl start pisowifi-gpio"
fi

echo ""
IP=$(hostname -I | awk '{print $1}')
echo "  🌐 Portal URL  : http://$IP:3000"
echo "  🔧 WifiSoft    : http://10.0.0.1/admin"
echo "  🪙 Coin pin    : Physical 29 (PA7 / NAEK S1)"
echo ""
echo "  View logs:"
echo "    sudo journalctl -u pisowifi-backend -f"
echo "    sudo journalctl -u pisowifi-gpio -f"
echo ""