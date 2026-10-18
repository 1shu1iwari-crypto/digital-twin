"""Wearable ingestion pipeline: multi-sample aggregation, backfill, deduplication, and mobile companion summary."""
from datetime import date, timedelta
import json
import math
import numpy as np
import pandas as pd
from .config import load_config
from .store import Store
from .twin import snapshot

def validate_signal_bounds(signal: str, value: float) -> bool:
    bounds = load_config()["signals"][signal]["bounds"]
    return bounds[0] <= value <= bounds[1]

def aggregate_samples(samples: list[dict]) -> dict:
    """Aggregates intra-day wearable samples into a single daily observation.

    Aggregation logic:
    - steps, sleep_hours: sum of intra-day segments
    - resting_hr: minimum of valid resting samples (basal rate)
    - hrv, spo2, respiratory_rate, systolic_bp, diastolic_bp, weight: mean of valid samples
    """
    if not samples:
        return {}
    
    cfg = load_config()
    signals = list(cfg["signals"].keys())
    aggregated: dict[str, float | None] = {}
    
    for sig in signals:
        valid_vals = []
        bounds = cfg["signals"][sig]["bounds"]
        for s in samples:
            val = s.get(sig)
            if val is not None and not (isinstance(val, float) and math.isnan(val)):
                fval = float(val)
                if bounds[0] <= fval <= bounds[1]:
                    valid_vals.append(fval)
        
        if not valid_vals:
            aggregated[sig] = None
        elif len(valid_vals) == 1:
            aggregated[sig] = float(valid_vals[0])
        elif sig in ("steps", "sleep_hours"):
            total = sum(valid_vals)
            aggregated[sig] = round(total, 1 if sig == "sleep_hours" else 0)
        elif sig == "resting_hr":
            aggregated[sig] = round(float(np.min(valid_vals)), 1)
        elif sig == "weight":
            aggregated[sig] = round(float(np.mean(valid_vals)), 2)
        else:
            aggregated[sig] = round(float(np.mean(valid_vals)), 1)
            
    return aggregated

def is_differing_value(sig: str, val1: float, val2: float) -> bool:
    tol = 0.5 if sig in ("steps", "resting_hr", "hrv", "systolic_bp", "diastolic_bp") else 0.05
    return abs(float(val1) - float(val2)) > tol

def ingest_telemetry_batch(store: Store, pid: str, items: list[dict], allow_backfill: bool = True) -> dict:
    """Ingests a batch of wearable readings with multi-sample aggregation, backfill support, and deduplication."""
    patient = store.patient(pid)
    if patient is None:
        raise ValueError(f"Patient {pid} not found")

    if not items:
        return dict(patient_id=pid, inserted=0, updated=0, deduplicated=0, backfilled=0, affected_days=[])

    history = store.history(pid)
    cfg = load_config()

    # Determine base date
    if len(history):
        start_ts = str(history.iloc[0]["timestamp"])
        base_date = date.fromisoformat(start_ts) - timedelta(days=int(history.iloc[0]["day"]) - 1)
    else:
        # Use first item date as day 1
        first_date_str = str(items[0].get("timestamp"))
        base_date = date.fromisoformat(first_date_str)

    # Group input items by calendar date
    by_date: dict[str, list[dict]] = {}
    for item in items:
        ts = str(item.get("timestamp"))
        try:
            # Validate format
            date.fromisoformat(ts)
        except (ValueError, TypeError):
            raise ValueError(f"Invalid timestamp format: {ts}. Expected YYYY-MM-DD.")
        by_date.setdefault(ts, []).append(item)

    # Existing records indexed by day
    existing_by_day = {}
    if len(history):
        for row in history.to_dict("records"):
            existing_by_day[int(row["day"])] = row

    max_day_before = max(existing_by_day.keys()) if existing_by_day else 0
    inserted = 0
    updated = 0
    deduplicated = 0
    backfilled = 0
    affected_days: list[int] = []

    for ts_str, samples in sorted(by_date.items()):
        cal_date = date.fromisoformat(ts_str)
        target_day = (cal_date - base_date).days + 1
        if target_day < 1:
            raise ValueError(f"Date {ts_str} results in day {target_day} which precedes patient record start")

        agg = aggregate_samples(samples)
        if all(v is None for v in agg.values()):
            continue

        observation = {
            "patient_id": pid,
            "day": target_day,
            "timestamp": ts_str,
            **agg
        }

        if target_day in existing_by_day:
            existing = existing_by_day[target_day]
            # Check if incoming observation adds any new or differing readings
            has_new_info = False
            for sig in cfg["signals"]:
                new_val = observation.get(sig)
                if new_val is not None:
                    ex_val = existing.get(sig)
                    if ex_val is None or is_differing_value(sig, ex_val, new_val):
                        has_new_info = True
                        break

            if not has_new_info:
                deduplicated += 1
                continue

            # Merge and update existing
            merged = dict(existing)
            merged.update({k: v for k, v in observation.items() if v is not None})
            merged["timestamp"] = ts_str
            store.upsert_telemetry(pid, target_day, merged)
            existing_by_day[target_day] = merged
            updated += 1
            affected_days.append(target_day)
        else:
            if target_day <= max_day_before:
                if not allow_backfill:
                    raise ValueError(f"Backfill not allowed for past day {target_day}")
                backfilled += 1
            else:
                inserted += 1

            store.upsert_telemetry(pid, target_day, observation)
            existing_by_day[target_day] = observation
            affected_days.append(target_day)

    return dict(
        patient_id=pid,
        inserted=inserted,
        updated=updated,
        deduplicated=deduplicated,
        backfilled=backfilled,
        affected_days=sorted(affected_days),
        synthetic=True
    )

def generate_companion_summary(patient: dict, history: pd.DataFrame, model, current_day: int, review: dict = None) -> dict:
    """Produces a clean mobile companion JSON summary for patient or smartwatch glance."""
    cfg = load_config()
    current_snap = snapshot(patient, history, model, current_day)
    signals_today = {}
    today_records = history[history.day == current_day]
    today_obs = today_records.iloc[0].to_dict() if len(today_records) else {}

    signals_synced = 0
    signals_total = len(cfg["signals"])

    for sig_info in current_snap["signals"]:
        key = sig_info["key"]
        val = sig_info["value"]
        base = sig_info["baseline"]
        delta = sig_info["delta"]
        if val is not None:
            signals_synced += 1

        state = "missing"
        if val is not None and base is not None:
            if abs(delta or 0) > 0.1 * abs(base):
                state = "elevated" if (delta or 0) > 0 else "below_baseline"
            else:
                state = "within_baseline"
        elif val is not None:
            state = "recorded"

        signals_today[key] = dict(
            label=sig_info["label"],
            value=val,
            unit=sig_info["unit"],
            baseline=base,
            delta=delta,
            state=state
        )

    risk_info = None
    if current_snap["risk"]:
        r = current_snap["risk"]
        risk_info = dict(
            probability=r["probability"],
            ci_lower=r.get("ci_lower"),
            ci_upper=r.get("ci_upper"),
            uncertainty_width=r.get("uncertainty_width"),
            threshold=r["threshold"]
        )

    return dict(
        patient_id=patient["patient_id"],
        patient_name=patient["name"],
        age=patient["age"],
        hf_phenotype=patient.get("hf_type", "HF"),
        day=current_day,
        timestamp=current_snap["timestamp"],
        status=current_snap["status"],
        risk=risk_info,
        today_vitals=signals_today,
        sync_quality=dict(
            signals_synced=signals_synced,
            signals_total=signals_total,
            completion_pct=round(signals_synced / signals_total * 100, 1),
            baseline_ready=current_snap["quality"]["baseline_ready"]
        ),
        clinical_review=dict(
            state=(review or {}).get("state", "unreviewed"),
            note=(review or {}).get("note", ""),
            updated_at=(review or {}).get("updated_at")
        ),
        synthetic=True,
        disclaimer="Synthetic demonstration only. Never clinically validated. Consult your care team directly."
    )
