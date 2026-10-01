import numpy as np
import pandas as pd
from .config import load_config
from .features import features_at

SIGNAL_NAMES = {"resting_hr": "Resting heart rate", "hrv": "Heart rate variability", "respiratory_rate": "Respiratory rate",
                "spo2": "Oxygen saturation", "steps": "Daily activity", "weight": "Body weight",
                "systolic_bp": "Systolic pressure", "diastolic_bp": "Diastolic pressure", "sleep_hours": "Sleep duration"}

def describe_feature(feature):
    for signal, name in SIGNAL_NAMES.items():
        if feature.startswith(signal + "_"):
            suffix = feature[len(signal)+1:]
            suffix = {"current": "current value", "deviation": "personal deviation", "slope_3": "3-day trend", "slope_7": "7-day trend",
                      "mean_3": "3-day mean", "mean_7": "7-day mean", "missing_7": "sensor gaps", "std_7": "7-day variability"}.get(suffix, suffix)
            return f"{name} · {suffix}"
    return feature.replace("_", " ").capitalize()

def snapshot(patient, history, model, day=None):
    cfg = load_config()
    if history.empty:
        return dict(patient_id=patient["patient_id"], risk=None, status="Awaiting data", signals=[], indices=[], quality=dict(coverage=0, baseline_ready=False), last_day=0, timestamp=None)
    day = int(day or history.day.max())
    past = history[history.day <= day].sort_values("day")
    features, baseline = features_at(patient, past, day, cfg)
    latest = past.iloc[-1]
    last7 = past[past.day > day-7]
    coverage = float(last7[list(cfg["signals"])].notna().to_numpy().mean())
    today_coverage = float(latest[list(cfg["signals"])].notna().mean())
    ready = day > cfg["baseline_days"] and all(x["ready"] for x in baseline.values())
    usable = ready and coverage >= .5 and today_coverage >= .5
    risk = model.predict(features) if usable else None
    status = "High risk" if risk and risk["probability"] >= cfg["thresholds"]["high"] else "Watch" if risk and risk["probability"] >= cfg["thresholds"]["watch"] else "Stable" if risk else "Insufficient data"
    signals = []
    for signal, spec in cfg["signals"].items():
        value = latest[signal]
        base = baseline[signal]
        deviation = features[signal + "_deviation"]
        signals.append(dict(key=signal, label=SIGNAL_NAMES[signal], value=float(value) if pd.notna(value) else None,
                            unit=spec["unit"], baseline=base["median"], deviation=float(deviation) if np.isfinite(deviation) else None,
                            delta=float(value-base["median"]) if pd.notna(value) and base["ready"] else None))
    def d(signal, direction=1):
        value = features[signal + "_deviation"]
        return max(0, value*direction) if np.isfinite(value) else np.nan
    # Bounded engineering indices, not physiological measurements or percentages.
    index = lambda value: round(float(100*(1-np.exp(-value/5))), 1) if np.isfinite(value) else None
    def stability(value):
        score = index(value)
        return 100-score if score is not None else None
    indices = [dict(name="Congestion", value=index((d("weight")+d("respiratory_rate"))/2), direction="burden"),
               dict(name="Autonomic stress", value=index((d("resting_hr")+d("hrv",-1))/2), direction="burden"),
               dict(name="Oxygenation stability", value=stability(d("spo2",-1)), direction="stability"),
               dict(name="Functional capacity", value=stability(d("steps",-1)), direction="stability"),
               dict(name="Hemodynamic stability", value=stability(abs(features["systolic_bp_deviation"])), direction="stability")]
    if not usable:
        indices = [{**entry, "value": None} for entry in indices]
    if risk:
        for contribution in risk["explanation"]["contributions"]:
            contribution["label"] = describe_feature(contribution["feature"])
    return dict(patient_id=patient["patient_id"], risk=risk, status=status, signals=signals, indices=indices,
                quality=dict(coverage=coverage, today_coverage=today_coverage, baseline_ready=ready, baseline_days=cfg["baseline_days"],
                             note="Research prototype; sensor gaps may reduce reliability"),
                last_day=day, timestamp=str(latest.timestamp), synthetic=True)
