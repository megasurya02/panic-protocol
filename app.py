import csv
from datetime import datetime
import io
import os
import random
import sqlite3
import threading
from flask import Flask, jsonify, render_template, request, Response

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "panic_protocol.db")
db_lock = threading.Lock()

TIERS = {
    1: {
        "name": "Tier 1 - Ultrasonic 22 kHz (Soft Alert)",
        "led_text": "Continuous White LED",
        "led": "solid",
        "freq": 22,
    },
    2: {
        "name": "Tier 2 - High-Intensity Variable 28-32 kHz",
        "led_text": "Fast Strobe LED",
        "led": "strobe",
        "freq": 30,
    },
    3: {
        "name": "Tier 3 - Bio-acoustic Distress Siren",
        "led_text": "Randomized High-Frequency Flash Pattern",
        "led": "random",
        "freq": 36,
    },
}


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            entity TEXT NOT NULL,
            visit_count INTEGER NOT NULL,
            action TEXT NOT NULL,
            status TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    defaults = {
        "boar_visits": "0",
        "scenario": "clear",
        "tier": "0",
        "confidence": "0",
    }
    for key, value in defaults.items():
        conn.execute(
            "INSERT OR IGNORE INTO state (key, value) VALUES (?, ?)", (key, value)
        )
    conn.commit()
    conn.close()


def get_state(conn):
    rows = conn.execute("SELECT key, value FROM state").fetchall()
    return {row["key"]: row["value"] for row in rows}


def set_state(conn, key, value):
    conn.execute(
        "INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)",
        (key, str(value)),
    )


def add_event(conn, entity, visit_count, action, status):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn.execute(
        "INSERT INTO events (timestamp, entity, visit_count, action, status) VALUES (?, ?, ?, ?, ?)",
        (timestamp, entity, visit_count, action, status),
    )


def build_status(conn):
    state = get_state(conn)
    scenario = state["scenario"]
    visits = int(state["boar_visits"])
    tier = int(state["tier"])
    confidence = state["confidence"]

    freq_khz = 0
    strobe_mode = "Off"

    status = {
        "visit_count": visits,
        "consecutive_boar_visits": visits,
        "scenario": scenario,
        "frequency_khz": 0,
        "strobe_mode": "Off",
        "pir": {
            "level": "idle",
            "value": "No Motion",
            "detail": "PIR [SIMULATED] - monitoring field perimeter",
        },
        "camera": {
            "level": "idle",
            "value": "Scanning - Field Clear",
            "detail": "Edge-AI Camera [SIMULATED] - no target in frame",
        },
        "esp32": {
            "level": "ok",
            "value": "Linked - Idle",
            "detail": "ESP32 Controller [SIMULATED] - heartbeat OK",
        },
        "deterrent": {
            "level": "idle",
            "value": "Standby",
            "detail": "Buzzer + Strobe LED [SIMULATED] - OFF",
            "active": False,
            "tier": 0,
            "led": "off",
        },
    }

    if scenario == "boar":
        info = TIERS.get(tier, TIERS[1])
        action_text = info["name"] + " + " + info["led_text"]
        freq_khz = info["freq"]
        strobe_mode = info["led_text"]

        status["frequency_khz"] = freq_khz
        status["strobe_mode"] = strobe_mode
        status["current_animal"] = "Wild Boar"
        status["pir"] = {
            "level": "alert",
            "value": "Motion Detected",
            "detail": "PIR [SIMULATED] - movement in zone",
        }
        status["camera"] = {
            "level": "alert",
            "value": "Wild Boar Detected",
            "detail": "Edge-AI [SIMULATED] - confidence " + confidence + "%",
        }
        status["esp32"] = {
            "level": "active",
            "value": "Linked - Executing",
            "detail": "ESP32 [SIMULATED] - running Tier "
            + str(tier)
            + " command",
        }
        status["deterrent"] = {
            "level": "active",
            "value": "Tier " + str(tier) + " ACTIVE",
            "detail": action_text + " [SIMULATED]",
            "active": True,
            "tier": tier,
            "led": info["led"],
        }
    elif scenario == "other":
        freq_khz = 12
        strobe_mode = "Soft Warning Blink"
        status["frequency_khz"] = freq_khz
        status["strobe_mode"] = strobe_mode
        status["current_animal"] = "Non-Target Animal"
        status["pir"] = {
            "level": "alert",
            "value": "Motion Detected",
            "detail": "PIR [SIMULATED] - movement in zone",
        }
        status["camera"] = {
            "level": "info",
            "value": "Non-Target Movement",
            "detail": "Edge-AI [SIMULATED] - not a wild boar ("
            + confidence
            + "%)",
        }
        status["esp32"] = {
            "level": "ok",
            "value": "Linked - Idle",
            "detail": "ESP32 [SIMULATED] - no deterrent command sent",
        }
        status["deterrent"] = {
            "level": "info",
            "value": "Passive Watch",
            "detail": (
                "No deterrent fired - event logged as Ignored [SIMULATED]"
            ),
            "active": False,
            "tier": 0,
            "led": "off",
        }

    return status


def fetch_events(conn):
    rows = conn.execute("SELECT * FROM events ORDER BY id DESC").fetchall()
    return [dict(row) for row in rows]


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/status")
def api_status():
    with db_lock:
        conn = get_db()
        try:
            return jsonify(build_status(conn))
        finally:
            conn.close()


@app.route("/api/events")
def api_events():
    with db_lock:
        conn = get_db()
        try:
            return jsonify(fetch_events(conn))
        finally:
            conn.close()


# Handles both /api/simulate and /api/trigger for full compatibility
@app.route("/api/simulate", methods=["POST"])
@app.route("/api/trigger", methods=["POST"])
def api_simulate():
    data = request.get_json(silent=True) or {}
    kind = data.get("type") or data.get("scenario") or data.get("animal") or ""

    if kind in ("wild_boar", "boar"):
        kind = "boar"
    elif kind in ("other", "stray"):
        kind = "other"
    elif kind in ("clear", "none", "reset"):
        kind = "clear"
    else:
        return jsonify({"error": "Invalid simulation type"}), 400

    with db_lock:
        conn = get_db()
        try:
            state = get_state(conn)
            visits = int(state["boar_visits"])

            if kind == "boar":
                visits += 1
                tier = min(visits, 3)
                confidence = random.randint(91, 99)
                info = TIERS[tier]
                action_text = info["name"] + " + " + info["led_text"]
                set_state(conn, "boar_visits", visits)
                set_state(conn, "scenario", "boar")
                set_state(conn, "tier", tier)
                set_state(conn, "confidence", confidence)
                add_event(
                    conn, "Wild Boar", visits, action_text, "Deterrent Activated"
                )
                message = (
                    "Wild Boar visit #"
                    + str(visits)
                    + " - Tier "
                    + str(tier)
                    + " deterrent activated"
                )
            elif kind == "other":
                confidence = random.randint(80, 95)
                set_state(conn, "scenario", "other")
                set_state(conn, "tier", 0)
                set_state(conn, "confidence", confidence)
                add_event(
                    conn,
                    "Other Movement (Stray Animal)",
                    0,
                    "Passive Watch - Logged, No Deterrent",
                    "Ignored",
                )
                message = "Non-target movement logged - passive watch only"
            else:
                set_state(conn, "scenario", "clear")
                set_state(conn, "tier", 0)
                set_state(conn, "confidence", 0)
                add_event(
                    conn,
                    "None (Field Clear)",
                    0,
                    "Deterrent stopped - field cleared",
                    "Cleared",
                )
                message = (
                    "Field cleared - deterrent stopped (boar visit count kept"
                    " at " + str(visits) + ")"
                )

            conn.commit()
            return jsonify({"message": message, "status": build_status(conn)})
        finally:
            conn.close()


@app.route("/api/reset", methods=["POST"])
def api_reset():
    with db_lock:
        conn = get_db()
        try:
            conn.execute("DELETE FROM events")
            conn.execute("DELETE FROM sqlite_sequence WHERE name = 'events'")
            set_state(conn, "boar_visits", 0)
            set_state(conn, "scenario", "clear")
            set_state(conn, "tier", 0)
            set_state(conn, "confidence", 0)
            conn.commit()
            return jsonify(
                {
                    "message": "Simulation and data reset - visit counter is 0",
                    "status": build_status(conn),
                }
            )
        finally:
            conn.close()


@app.route("/api/export")
def api_export():
    with db_lock:
        conn = get_db()
        try:
            rows = conn.execute(
                "SELECT * FROM events ORDER BY id DESC"
            ).fetchall()
        finally:
            conn.close()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "ID",
            "Timestamp",
            "Detected Entity",
            "Visit Count",
            "Deterrent Action Taken",
            "Trigger Status",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row["id"],
                row["timestamp"],
                row["entity"],
                row["visit_count"],
                row["action"],
                row["status"],
            ]
        )

    content = "\ufeff" + buffer.getvalue()
    return Response(
        content,
        mimetype="text/csv",
        headers={
            "Content-Disposition": (
                "attachment; filename=panic_protocol_history.csv"
            )
        },
    )


init_db()

if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)