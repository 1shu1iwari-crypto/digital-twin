"""Causal daily features: no observations after the prediction day are accessed."""
import numpy as np
import pandas as pd
from .config import load_config
from .simulation import STATIC_FEATURES

def baseline_for(history, config=None):
    cfg = config or load_config()
    stable = history[history.day <= cfg["baseline_days"]]
    result = {}
    for signal, spec in cfg["signals"].items():
        vals = stable[signal].dropna().to_numpy(float)
        enough = len(vals) >= cfg["minimum_baseline_observations"]
        median = float(np.median(vals)) if enough else None
        scale = max(float(np.median(np.abs(vals - median))), spec["scale_floor"]) if enough else None
        result[signal] = dict(median=median, mad_scale=scale, count=len(vals), ready=enough)
    return result

def features_at(patient, history, day, config=None):
    cfg = config or load_config()
    past = history[history.day <= day].sort_values("day")
    if past.empty:
        raise ValueError("No observations at this prediction day")
    baseline = baseline_for(past, cfg)
    features = {key: float(patient[key]) for key in STATIC_FEATURES}
    for signal in cfg["signals"]:
        current = past.iloc[-1][signal]
        features[f"{signal}_current"] = float(current) if pd.notna(current) else np.nan
        for window in (3, 7):
            data = past[past.day > day-window][["day", signal]].dropna()
            features[f"{signal}_mean_{window}"] = float(data[signal].mean()) if len(data) else np.nan
            features[f"{signal}_slope_{window}"] = float(np.polyfit(data.day, data[signal], 1)[0]) if len(data) >= 2 else np.nan
        window7 = past[past.day > day-7]
        features[f"{signal}_missing_7"] = float(window7[signal].isna().mean())
        features[f"{signal}_std_7"] = float(window7[signal].std()) if window7[signal].count() >= 2 else np.nan
        base = baseline[signal]
        features[f"{signal}_deviation"] = float((current-base["median"])/base["mad_scale"]) if base["ready"] and pd.notna(current) else np.nan
    return features, baseline

def build_dataset(patients, observations, outcomes, config=None):
    cfg = config or load_config()
    frames = []
    outcomes = outcomes.set_index("patient_id")
    for patient in patients.to_dict("records"):
        history = observations[observations.patient_id == patient["patient_id"]]
        outcome = outcomes.loc[patient["patient_id"]]
        event = outcome.event_day
        history = history.sort_values("day").reset_index(drop=True)
        frame = history[["patient_id", "day"]].copy()
        frame["target"] = ((history.day < event) & (event <= history.day + cfg["prediction_horizon"])).astype(int) if pd.notna(event) else 0
        for key in STATIC_FEATURES:
            frame[key] = float(patient[key])
        baseline = baseline_for(history, cfg)
        def slope(values):
            valid = np.isfinite(values)
            return float(np.polyfit(np.arange(len(values))[valid], values[valid], 1)[0]) if valid.sum() >= 2 else np.nan
        for signal in cfg["signals"]:
            series = history[signal].astype(float)
            frame[f"{signal}_current"] = series
            for window in (3, 7):
                frame[f"{signal}_mean_{window}"] = series.rolling(window, min_periods=1).mean()
                frame[f"{signal}_slope_{window}"] = series.rolling(window, min_periods=2).apply(slope, raw=True)
            frame[f"{signal}_missing_7"] = series.isna().rolling(7, min_periods=1).mean()
            frame[f"{signal}_std_7"] = series.rolling(7, min_periods=2).std()
            base = baseline[signal]
            frame[f"{signal}_deviation"] = (series-base["median"])/base["mad_scale"] if base["ready"] else np.nan
        frame = frame[(frame.day > cfg["baseline_days"]) & ((frame.target == 1) | (frame.day + cfg["prediction_horizon"] <= outcome.followup_day))]
        frames.append(frame)
    return pd.concat(frames, ignore_index=True)
