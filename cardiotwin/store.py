"""SQLite ledger; replay observations are withheld from all inference reads."""
import json
import sqlite3
from pathlib import Path
import pandas as pd
from .config import ROOT, load_config
from .simulation import generate_cohort

class Store:
    def __init__(self, path=None):
        self.path = Path(path or ROOT / "data/demo.sqlite")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.executescript("""
            CREATE TABLE IF NOT EXISTS patients (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS telemetry (patient_id TEXT, day INTEGER, payload TEXT NOT NULL, PRIMARY KEY(patient_id, day));
            CREATE TABLE IF NOT EXISTS replay (patient_id TEXT, day INTEGER, payload TEXT NOT NULL, PRIMARY KEY(patient_id, day));
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """)
        if not self.patients():
            self.seed()

    def connect(self):
        return sqlite3.connect(self.path, timeout=30)

    def seed(self):
        patients, observations, _ = generate_cohort(n=32, seed=7026)
        # Independent seed, disjoint from the training, validation and test simulations.
        observations = observations.astype(object).where(pd.notna(observations), None)
        with self.connect() as conn:
            for table in ["patients", "telemetry", "replay", "settings"]:
                conn.execute(f"DELETE FROM {table}")
            for patient in patients.to_dict("records"):
                conn.execute("INSERT INTO patients VALUES (?,?)", (patient["patient_id"], json.dumps(patient)))
            for obs in observations.to_dict("records"):
                table = "telemetry" if obs["day"] <= 35 else "replay"
                conn.execute(f"INSERT INTO {table} VALUES (?,?,?)", (obs["patient_id"], obs["day"], json.dumps(obs)))
            conn.execute("INSERT INTO settings VALUES ('replay_day','35')")

    def patients(self):
        with self.connect() as conn:
            return [json.loads(r[0]) for r in conn.execute("SELECT payload FROM patients ORDER BY id")]

    def patient(self, pid):
        with self.connect() as conn:
            row = conn.execute("SELECT payload FROM patients WHERE id=?", (pid,)).fetchone()
        return json.loads(row[0]) if row else None

    def history(self, pid):
        with self.connect() as conn:
            rows = [json.loads(r[0]) for r in conn.execute("SELECT payload FROM telemetry WHERE patient_id=? ORDER BY day", (pid,))]
        return pd.DataFrame(rows) if rows else pd.DataFrame(columns=["patient_id", "day", "timestamp", *load_config()["signals"]])

    def add_patient(self, patient):
        with self.connect() as conn:
            conn.execute("INSERT INTO patients VALUES (?,?)", (patient["patient_id"], json.dumps(patient)))

    def append(self, pid, observation):
        with self.connect() as conn:
            previous = conn.execute("SELECT MAX(day) FROM telemetry WHERE patient_id=?", (pid,)).fetchone()[0] or 0
            if observation["day"] != previous+1:
                raise ValueError("Telemetry must append exactly the next daily observation")
            conn.execute("INSERT INTO telemetry VALUES (?,?,?)", (pid, observation["day"], json.dumps(observation)))

    def advance(self):
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            day = int(conn.execute("SELECT value FROM settings WHERE key='replay_day'").fetchone()[0])
            if day >= load_config()["days"]:
                return dict(day=day, updated=0, finished=True)
            next_day = day+1
            rows = conn.execute("SELECT patient_id, day, payload FROM replay WHERE day=?", (next_day,)).fetchall()
            updated = 0
            for pid, obs_day, payload in rows:
                last = conn.execute("SELECT MAX(day) FROM telemetry WHERE patient_id=?", (pid,)).fetchone()[0]
                if last == obs_day-1:
                    conn.execute("INSERT OR IGNORE INTO telemetry VALUES (?,?,?)", (pid, obs_day, payload))
                    updated += 1
            conn.execute("UPDATE settings SET value=? WHERE key='replay_day'", (str(next_day),))
        return dict(day=next_day, updated=updated, finished=next_day >= load_config()["days"])

    def replay_day(self):
        with self.connect() as conn:
            return int(conn.execute("SELECT value FROM settings WHERE key='replay_day'").fetchone()[0])
