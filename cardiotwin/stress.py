"""Independent stress-test evaluation for CardioTwin-HF.

Tests frozen model robustness under out-of-distribution noise, missingness, sensor dropout,
calibration drift, acute/subacute onset speeds, and hard-negative prevalence.
Never retrains or fine-tunes the model; never exposes stress data to fitting or calibration.
"""
from datetime import date, timedelta
import json
from pathlib import Path
import numpy as np
import pandas as pd
import yaml
from .config import ARTIFACTS, ROOT, load_config
from .features import baseline_for, build_dataset
from .model import RiskModel, metrics, sigmoid


def load_stress_config(path=None):
    file_path = Path(path or ROOT / "config/stress.yaml")
    with file_path.open() as f:
        return yaml.safe_load(f)


def generate_stress_cohort(scenario_key, n=None, seed=None, stress_cfg=None, sim_cfg=None):
    """Generate a synthetic cohort under a specific stress test scenario.

    Seeds are explicitly offset from base_seed (default >= 9026) to ensure complete
    separation from training (2026) and demo replay (7026).
    """
    stress_cfg = stress_cfg or load_stress_config()
    sim_cfg = sim_cfg or load_config()

    if scenario_key not in stress_cfg["scenarios"]:
        raise ValueError(f"Unknown stress scenario: '{scenario_key}'. Available: {list(stress_cfg['scenarios'])}")

    spec = stress_cfg["scenarios"][scenario_key]
    scenario_keys = list(stress_cfg["scenarios"].keys())
    scenario_idx = scenario_keys.index(scenario_key)

    actual_seed = seed if seed is not None else (stress_cfg.get("base_seed", 9026) + scenario_idx * 17)
    rng = np.random.default_rng(actual_seed)

    patient_count = n or stress_cfg.get("patients_per_scenario", 150)
    days = sim_cfg["days"]
    baseline_days = sim_cfg["baseline_days"]
    signals = sim_cfg["signals"]

    patients, observations, outcomes = [], [], []
    start = date(2026, 7, 1)

    noise_mult = spec.get("noise_multiplier", 1.0)
    missing_frac = spec.get("missing_fraction", sim_cfg["missing_fraction"])
    artifact_frac = spec.get("artifact_fraction", sim_cfg["artifact_fraction"])
    hard_neg_frac = spec.get("hard_negative_fraction", sim_cfg["hard_negative_fraction"])
    onset_range = spec.get("onset_days_range", sim_cfg["onset_days_range"])
    affected_prob = spec.get("affected_signal_prob", 0.85)
    sensor_dropout = set(spec.get("sensor_dropout") or [])
    drift_spec = spec.get("drift") or {}
    bursty_missing = spec.get("bursty_missing", False)
    burst_len = spec.get("burst_length", 3)

    for i in range(patient_count):
        pid = f"STRESS-{scenario_key[:4].upper()}-{i + 1:04d}"
        age = int(rng.integers(35, 86))
        lvef = round(float(rng.uniform(22, 64)), 1)
        nyha = int(rng.choice([2, 3, 4], p=[0.5, 0.4, 0.1]))
        ckd, copd = int(rng.random() < 0.28), int(rng.random() < 0.15)
        admissions = int(rng.choice([0, 1, 2, 3], p=[.35, .4, .2, .05]))
        patient = dict(patient_id=pid, name=f"Stress patient {i + 1:02d}", age=age,
                       sex=str(rng.choice(["Female", "Male"])), lvef=lvef,
                       hf_type="HFrEF" if lvef <= 40 else "HFmrEF" if lvef < 50 else "HFpEF",
                       nyha=nyha, creatinine=round(float(rng.uniform(.7, 1.5) + ckd * .8), 2),
                       egfr=round(float(rng.uniform(32, 60) if ckd else rng.uniform(60, 110)), 1),
                       sodium=round(float(rng.normal(138, 2.5)), 1),
                       hemoglobin=round(float(rng.normal(12.5, 1.5)), 1),
                       previous_admissions=admissions, diabetes=int(rng.random() < .32),
                       ckd=ckd, copd=copd, synthetic=True, stress_scenario=scenario_key)
        patients.append(patient)

        event_p = np.clip(sim_cfg["event_fraction"] + .04 * (nyha - 2) + .02 * admissions - .03, .15, .7)
        event_day = int(rng.integers(*sim_cfg["event_day_range"])) if rng.random() < event_p else None
        negative = event_day is None and rng.random() < hard_neg_frac
        transient_day = int(rng.integers(22, 48))
        onset = int(rng.integers(*onset_range))

        outcomes.append(dict(patient_id=pid, event_day=event_day, followup_day=days,
                             scenario="deteriorating" if event_day else "transient" if negative else "stable"))

        baselines = {s: rng.uniform(*s_spec["baseline"]) for s, s_spec in signals.items()}
        if copd:
            baselines["spo2"] -= rng.uniform(1, 3)
        magnitudes = {s: rng.uniform(*s_spec["deterioration"]) for s, s_spec in signals.items()}
        affected = {s: rng.random() < affected_prob for s in signals}
        offsets = {s: int(rng.integers(-3, 4)) for s in signals}
        previous_noise = {s: 0.0 for s in signals}

        # Pre-generate burst missingness mask if bursty
        burst_masks = {}
        if bursty_missing:
            for s in signals:
                mask = np.zeros(days + 1, dtype=bool)
                num_bursts = int((days * missing_frac) / max(1, burst_len))
                for _ in range(num_bursts):
                    b_start = int(rng.integers(1, max(2, days - burst_len)))
                    mask[b_start:b_start + burst_len] = True
                burst_masks[s] = mask

        for day in range(1, min(days + 1, event_day or days + 1)):
            row = dict(patient_id=pid, day=day, timestamp=str(start + timedelta(days=day - 1)))
            for s, s_spec in signals.items():
                effective_noise = s_spec["noise"] * noise_mult
                previous_noise[s] = .35 * previous_noise[s] + rng.normal(0, effective_noise)
                value = baselines[s] + previous_noise[s]

                # Deterioration progression
                if event_day and affected[s]:
                    progression = np.clip((day - (event_day - onset + offsets[s])) / onset, 0, 1)
                    value += magnitudes[s] * (progression ** 1.25)

                # Hard negative transient perturb
                if negative and s in ["weight", "resting_hr", "steps", "respiratory_rate"]:
                    value += magnitudes[s] * np.exp(-((day - transient_day) / 3.3) ** 2) * rng.uniform(.4, 1.2)

                # Sensor calibration drift (only after baseline)
                if day > baseline_days and s in drift_spec:
                    value += drift_spec[s] * (day - baseline_days)

                # Artifact spikes
                if rng.random() < artifact_frac:
                    value += rng.normal(0, effective_noise * 5)

                # Sensor dropout or missingness
                is_dropped = (day > baseline_days and s in sensor_dropout)
                is_missing = (bursty_missing and burst_masks[s][day]) or (rng.random() < missing_frac)

                if is_dropped or is_missing:
                    row[s] = None
                else:
                    row[s] = round(float(np.clip(value, *s_spec["bounds"])), 2)

            observations.append(row)

    return pd.DataFrame(patients), pd.DataFrame(observations), pd.DataFrame(outcomes)


def evaluate_stress_scenario(model, scenario_key, n=None, seed=None, stress_cfg=None, sim_cfg=None):
    """Run frozen model inference over a stress cohort and compute metrics & abstentions."""
    sim_cfg = sim_cfg or load_config()
    stress_cfg = stress_cfg or load_stress_config()

    patients, observations, outcomes = generate_stress_cohort(
        scenario_key, n=n, seed=seed, stress_cfg=stress_cfg, sim_cfg=sim_cfg
    )

    dataset = build_dataset(patients, observations, outcomes, sim_cfg)
    if dataset.empty:
        return dict(scenario=scenario_key, n_patients=len(patients), n_samples=0, abstained_fraction=1.0)

    meta = model.meta
    slope, intercept = meta["calibration"]["slope"], meta["calibration"]["intercept"]
    threshold = meta["threshold"]

    import xgboost as xgb
    features_df = dataset[meta["features"]].astype(float)
    dmatrix = xgb.DMatrix(features_df, feature_names=meta["features"])
    margins = model.booster.predict(dmatrix, output_margin=True)
    probabilities = np.asarray(sigmoid(slope * margins + intercept), dtype=float)

    # Efficient vector-level abstention evaluation
    signals_list = list(sim_cfg["signals"])
    coverage_map = {}
    for pid, p_obs in observations.groupby("patient_id"):
        p_obs = p_obs.sort_values("day")
        b = baseline_for(p_obs, sim_cfg)
        b_ready = all(x["ready"] for x in b.values())
        today_cov = p_obs[signals_list].notna().mean(axis=1).to_numpy()
        cov_7 = pd.Series(today_cov).rolling(7, min_periods=1).mean().to_numpy()
        for d, t_c, c_7 in zip(p_obs["day"].to_numpy(), today_cov, cov_7):
            usable = bool(b_ready and (d > sim_cfg["baseline_days"]) and (c_7 >= 0.5) and (t_c >= 0.5))
            coverage_map[(pid, int(d))] = usable

    evaluated_mask = np.array([coverage_map.get((r.patient_id, int(r.day)), False) for r in dataset.itertuples()], dtype=bool)
    abstained = ~evaluated_mask

    base_metrics = metrics(dataset, probabilities, threshold, outcomes)

    # Compute metrics on non-abstained subset (if sufficient samples exist)
    if evaluated_mask.sum() > 20 and len(np.unique(dataset.target[evaluated_mask])) > 1:
        usable_dataset = dataset[evaluated_mask].copy().reset_index(drop=True)
        usable_probs = probabilities[evaluated_mask]
        usable_metrics = metrics(usable_dataset, usable_probs, threshold, outcomes)
    else:
        usable_metrics = {k: None for k in base_metrics}

    desc = stress_cfg["scenarios"][scenario_key]["description"]
    return dict(
        scenario=scenario_key,
        description=desc,
        n_patients=len(patients),
        n_samples=len(dataset),
        n_evaluated=int(evaluated_mask.sum()),
        abstained_fraction=float(abstained.mean()),
        raw_overall_metrics=base_metrics,
        usable_metrics=usable_metrics
    )


def run_stress_battery(model_dir=ARTIFACTS, n_patients=None, scenarios=None, output_path=None):
    """Run full stress testing battery against the frozen risk model."""
    model = RiskModel(model_dir)
    stress_cfg = load_stress_config()
    target_scenarios = scenarios or list(stress_cfg["scenarios"].keys())

    results = []
    print(f"Executing stress tests across {len(target_scenarios)} scenarios...")
    for s_key in target_scenarios:
        print(f"  - Running scenario: {s_key}...", flush=True)
        res = evaluate_stress_scenario(model, s_key, n=n_patients, stress_cfg=stress_cfg)
        results.append(res)

    report = dict(
        synthetic=True,
        clinical_validation=False,
        base_seed=stress_cfg.get("base_seed", 9026),
        patients_per_scenario=n_patients or stress_cfg.get("patients_per_scenario", 150),
        model_artifact_sha256=model.meta.get("config_sha256"),
        threshold=model.meta["threshold"],
        scenarios=results
    )

    if output_path:
        out_p = Path(output_path)
        out_p.parent.mkdir(parents=True, exist_ok=True)
        out_p.write_text(json.dumps(report, indent=2))
        print(f"Saved stress evaluation report to: {out_p}")

    return report
