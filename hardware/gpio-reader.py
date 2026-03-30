#!/usr/bin/env python3
# ============================================================
# CIT Piso WiFi — GPIO Coin Reader
# Runs permanently on the Orange Pi One.
#
# HOW IT WORKS:
#   The universal coin acceptor sends PULSES to GPIO pin PA7
#   (physical pin 29 on Orange Pi One = NAEK board S1 pin).
#
#   Pulse count per coin (standard PH coin acceptor):
#     ₱1  = 1  pulse
#     ₱5  = 5  pulses
#     ₱10 = 10 pulses
#     ₱20 = 20 pulses
#
#   After PULSE_TIMEOUT (0.4s of silence), pulses are counted,
#   mapped to peso value, then POSTed to the Node.js backend.
#
# INSTALL:
#   pip3 install OPi.GPIO requests
#   sudo python3 gpio-reader.py
#
# AUTO-START:
#   sudo cp gpio-reader.service /etc/systemd/system/
#   sudo systemctl enable pisowifi-gpio
#   sudo systemctl start pisowifi-gpio
# ============================================================

import sys
import time
import threading
import logging
import requests

# OPi.GPIO is an Orange Pi / Linux-only library.
# The Pylance warning in VS Code on Windows is expected and harmless —
# this script only ever runs on the Orange Pi hardware, not your PC.
try:
    import OPi.GPIO as GPIO           # runs on Orange Pi  # type: ignore
except ImportError:
    # ── Mock GPIO for development on Windows/Mac ──────────────────────
    # When running on your PC, GPIO calls are silently ignored.
    # Real GPIO only activates on the Orange Pi.
    class _MockGPIO:                  # type: ignore
        BOARD = FALLING = IN = OUT = PUD_UP = None
        def setmode(self, *a, **k): pass
        def setup(self, *a, **k):   pass
        def add_event_detect(self, *a, **k): pass
        def cleanup(self):           pass
    GPIO = _MockGPIO()
    logging.warning('⚠️  OPi.GPIO not found — MOCK mode active (dev/Windows). GPIO coin detection disabled.')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(message)s',
    datefmt='%H:%M:%S',
    handlers=[logging.StreamHandler(sys.stdout)]
)
log = logging.getLogger()

# ── Config ────────────────────────────────────────────────────
BACKEND_URL    = 'http://localhost:3000/api/coin'
COIN_PIN       = 7       # Physical pin 29 = PA7 = NAEK S1
PULSE_TIMEOUT  = 0.4     # seconds silence = end of coin
DEBOUNCE_MS    = 50      # milliseconds

# Pulse → peso map (adjust if your acceptor differs)
PULSE_MAP = {
    1:  1,
    5:  5,
    10: 10,
    20: 20,
}

# ── State ─────────────────────────────────────────────────────
pulse_count = 0
pulse_timer = None
lock        = threading.Lock()

# ── GPIO Setup ────────────────────────────────────────────────
GPIO.setmode(GPIO.BOARD)
GPIO.setup(COIN_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)

# ── Helpers ───────────────────────────────────────────────────
def find_peso(count):
    if count in PULSE_MAP:
        return PULSE_MAP[count]
    # Allow ±1 tolerance for worn-out coin acceptors
    for pulses, pesos in PULSE_MAP.items():
        if abs(count - pulses) <= 1:
            log.warning(f'Fuzzy pulse match: {count} → ₱{pesos}')
            return pesos
    return None

def send_coin(pesos):
    try:
        r = requests.post(BACKEND_URL, json={'amount': pesos}, timeout=3)
        d = r.json()
        if d.get('success'):
            log.info(f'✅  ₱{pesos} → {d["minutes"]} minutes granted')
        else:
            log.error(f'❌  Backend rejected: {d.get("message")}')
    except Exception as e:
        log.error(f'❌  Backend unreachable: {e}')

def process_coin():
    global pulse_count
    with lock:
        count       = pulse_count
        pulse_count = 0

    if count == 0:
        return

    log.info(f'🪙  {count} pulse(s) received')
    pesos = find_peso(count)

    if pesos:
        log.info(f'💰  Coin: ₱{pesos}')
        send_coin(pesos)
    else:
        log.warning(f'🚫  Unknown pulse count ({count}) — coin rejected')

# ── Interrupt callback ────────────────────────────────────────
def on_pulse(channel):
    global pulse_count, pulse_timer
    with lock:
        pulse_count += 1

    # Reset timeout on each pulse
    if pulse_timer and pulse_timer.is_alive():
        pulse_timer.cancel()
    pulse_timer = threading.Timer(PULSE_TIMEOUT, process_coin)
    pulse_timer.start()

GPIO.add_event_detect(
    COIN_PIN,
    GPIO.FALLING,
    callback=on_pulse,
    bouncetime=DEBOUNCE_MS
)

# ── Main ──────────────────────────────────────────────────────
log.info('═══════════════════════════════════')
log.info(' CIT Piso WiFi — GPIO Coin Reader  ')
log.info('═══════════════════════════════════')
log.info(f'  Pin     : Physical {COIN_PIN} (PA7 / NAEK S1)')
log.info(f'  Backend : {BACKEND_URL}')
log.info('  Waiting for coins...')
log.info('')

try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    log.info('Shutting down...')
finally:
    GPIO.cleanup()
    log.info('GPIO cleaned up.')