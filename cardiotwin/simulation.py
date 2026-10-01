"""Seeded, entirely fictional patient data; not Synthea or actual clinical records."""
from datetime import date, timedelta
import numpy as np
import pandas as pd
from .config import load_config

STATIC_FEATURES = ["age", "lvef", "nyha", "creatinine", "egfr", "sodium",
                   "hemoglobin", "previous_admissions", "diabetes", "ckd", "copd"]

def generate_cohort(n=None, seed=None, config=None):
    cfg = config or load_config()
    rng = np.random.default_rng(cfg["seed"] if seed is None else seed)
    patients, observations, outcomes = [], [], []
    start = date(2026, 7, 1)
    for i in range(n or cfg["patients"]):
        pid = f"HF-{i + 1:04d}"
        age = int(rng.integers(35, 86))
        lvef = round(float(rng.uniform(22, 64)), 1)
        nyha = int(rng.choice([2, 3, 4], p=[0.5, 0.4, 0.1]))
        ckd, copd = int(rng.random() < 0.28), int(rng.random() < 0.15)
        admissions = int(rng.choice([0, 1, 2, 3], p=[.35, .4, .2, .05]))
        patient = dict(patient_id=pid, name=f"Demo patient {i + 1:02d}", age=age,
                       sex=str(rng.choice(["Female", "Male"])), lvef=lvef,
                       hf_type="HFrEF" if lvef <= 40 else "HFmrEF" if lvef < 50 else "HFpEF",
                       nyha=nyha, creatinine=round(float(rng.uniform(.7, 1.5) + ckd * .8), 2),
                       egfr=round(float(rng.uniform(32, 60) if ckd else rng.uniform(60, 110)), 1),
                       sodium=round(float(rng.normal(138, 2.5)), 1),
                       hemoglobin=round(float(rng.normal(12.5, 1.5)), 1),
                       previous_admissions=admissions, diabetes=int(rng.random() < .32),
                       ckd=ckd, copd=copd, synthetic=True)
        patients.append(patient)
        event_p = np.clip(cfg["event_fraction"] + .04 * (nyha-2) + .02 * admissions - .03, .15, .7)
        event_day = int(rng.integers(*cfg["event_day_range"])) if rng.random() < event_p else None
        negative = event_day is None and rng.random() < cfg["hard_negative_fraction"]
        transient_day = int(rng.integers(22, 48))
        onset = int(rng.integers(*cfg["onset_days_range"]))
        outcomes.append(dict(patient_id=pid, event_day=event_day, followup_day=cfg["days"],
                             scenario="deteriorating" if event_day else "transient" if negative else "stable"))
        baselines = {s: rng.uniform(*spec["baseline"]) for s, spec in cfg["signals"].items()}
        if copd:
            baselines["spo2"] -= rng.uniform(1, 3)
        magnitudes = {s: rng.uniform(*spec["deterioration"]) for s, spec in cfg["signals"].items()}
        affected = {s: rng.random() < .85 for s in cfg["signals"]}
        offsets = {s: int(rng.integers(-3, 4)) for s in cfg["signals"]}
        previous_noise = {s: 0.0 for s in cfg["signals"]}
        for day in range(1, min(cfg["days"] + 1, event_day or cfg["days"] + 1)):
            row = dict(patient_id=pid, day=day, timestamp=str(start + timedelta(days=day-1)))
            for signal, spec in cfg["signals"].items():
                previous_noise[signal] = .35 * previous_noise[signal] + rng.normal(0, spec["noise"])
                value = baselines[signal] + previous_noise[signal]
                if event_day and affected[signal]:
                    progression = np.clip((day - (event_day - onset + offsets[signal])) / onset, 0, 1)
                    value += magnitudes[signal] * progression ** 1.25
                if negative and signal in ["weight", "resting_hr", "steps", "respiratory_rate"]:
                    value += magnitudes[signal] * np.exp(-((day - transient_day) / 3.3) ** 2) * rng.uniform(.4, 1)
                if rng.random() < cfg["artifact_fraction"]:
                    value += rng.normal(0, spec["noise"] * 5)
                row[signal] = None if rng.random() < cfg["missing_fraction"] else round(float(np.clip(value, *spec["bounds"])), 2)
            observations.append(row)
    return pd.DataFrame(patients), pd.DataFrame(observations), pd.DataFrame(outcomes)
