"""Calibrated, clinician-relevant evaluation for CardioTwin-HF.

Provides patient-level confidence intervals, alert fatigue operating budgets,
Expected Calibration Error (ECE), and per-event detection audit.
No medical diagnosis or causal intervention advice is generated.
"""
import json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, brier_score_loss, confusion_matrix, roc_auc_score

from .config import ARTIFACTS, load_config
from .features import baseline_for, build_dataset
from .model import RiskModel, sigmoid, split_patients
from .simulation import generate_cohort


def compute_ece(y_true, y_prob, n_bins=10):
    """Compute Expected Calibration Error (ECE) and Maximum Calibration Error (MCE)."""
    bin_boundaries = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    mce = 0.0
    bin_details = []

    for i in range(n_bins):
        in_bin = (y_prob > bin_boundaries[i]) & (y_prob <= bin_boundaries[i + 1])
        if i == 0:
            in_bin = (y_prob >= bin_boundaries[0]) & (y_prob <= bin_boundaries[1])

        prop_in_bin = float(np.mean(in_bin))
        if prop_in_bin > 0:
            accuracy_in_bin = float(np.mean(y_true[in_bin]))
            avg_confidence_in_bin = float(np.mean(y_prob[in_bin]))
            diff = abs(accuracy_in_bin - avg_confidence_in_bin)
            ece += prop_in_bin * diff
            mce = max(mce, diff)
            bin_details.append(dict(
                bin_lower=float(bin_boundaries[i]),
                bin_upper=float(bin_boundaries[i + 1]),
                fraction=prop_in_bin,
                observed_rate=accuracy_in_bin,
                predicted_rate=avg_confidence_in_bin,
                gap=diff
            ))

    return dict(ece=float(ece), mce=float(mce), bins=bin_details)


def event_audit(test_df, y_prob, threshold, outcomes):
    """Audit every decompensation event in the test split: detected vs missed, lead time, and clinical traits."""
    events = outcomes.set_index("patient_id").event_day.to_dict()
    patient_info = outcomes.set_index("patient_id").to_dict(orient="index")

    scored = test_df[["patient_id", "day", "target"]].copy()
    scored["prob"] = y_prob
    scored["alert"] = y_prob >= threshold

    audit_records = []
    total_events = 0
    detected_events = 0

    for pid, history in scored.groupby("patient_id"):
        history = history.sort_values("day")
        ev_day = events.get(pid)
        if pd.isna(ev_day):
            continue

        total_events += 1
        true_alerts = history[(history.target == 1) & history.alert]
        detected = len(true_alerts) > 0
        lead_time = float(ev_day - true_alerts.day.min()) if detected else None
        first_alert = int(true_alerts.day.min()) if detected else None

        if detected:
            detected_events += 1

        info = patient_info.get(pid, {})
        audit_records.append(dict(
            patient_id=pid,
            event_day=int(ev_day),
            detected=detected,
            first_alert_day=first_alert,
            lead_time_days=lead_time,
            max_risk_in_window=float(history[history.target == 1]["prob"].max()) if (history.target == 1).any() else 0.0,
            scenario=info.get("scenario", "unknown"),
        ))

    event_recall = detected_events / max(1, total_events)
    lead_times = [r["lead_time_days"] for r in audit_records if r["lead_time_days"] is not None]
    mean_lead = float(np.mean(lead_times)) if lead_times else None

    return dict(
        total_test_events=total_events,
        detected_events=detected_events,
        missed_events=total_events - detected_events,
        event_recall=float(event_recall),
        mean_lead_days=mean_lead,
        events=audit_records
    )


def alert_budget_curve(test_df, y_prob, outcomes, target_budgets=(0.20, 0.35, 0.50, 0.75, 1.00)):
    """Find operating points matching specific clinician false-alert budgets (episodes / patient-month)."""
    scored = test_df[["patient_id", "day", "target"]].copy()
    events = outcomes.set_index("patient_id").event_day.to_dict()
    event_count = sum(pd.notna(v) for v in events.values())
    patient_months = len(test_df) / 30.0

    # Grid search across candidate thresholds up to 1.0
    candidates = np.linspace(0.05, 1.0, 191)
    curve_points = []

    for t in candidates:
        alerts = y_prob >= t
        scored["alert"] = alerts

        false_episodes = 0
        detected_pids = set()
        lead_times = []

        for pid, history in scored.groupby("patient_id"):
            history = history.sort_values("day")
            prev = False
            for r in history.itertuples():
                if r.alert and not prev and not r.target:
                    false_episodes += 1
                prev = r.alert

            ev = events.get(pid)
            if pd.notna(ev):
                true_alerts = history[(history.target == 1) & history.alert]
                if len(true_alerts):
                    detected_pids.add(pid)
                    lead_times.append(float(ev - true_alerts.day.min()))

        fa_rate = false_episodes / max(0.1, patient_months)
        ev_recall = len(detected_pids) / max(1, event_count)
        sens = float(np.mean(alerts[test_df.target == 1])) if (test_df.target == 1).any() else 0.0
        spec = float(np.mean(~alerts[test_df.target == 0])) if (test_df.target == 0).any() else 0.0

        curve_points.append(dict(
            threshold=float(t),
            false_alerts_per_month=float(fa_rate),
            event_recall=float(ev_recall),
            daily_sensitivity=float(sens),
            daily_specificity=float(spec),
            mean_lead_days=float(np.mean(lead_times)) if lead_times else None
        ))

    # For each target budget, select threshold achieving closest rate <= budget
    budget_results = []
    for budget in target_budgets:
        matching = [p for p in curve_points if p["false_alerts_per_month"] <= budget]
        if matching:
            # Pick the one with highest event recall among those meeting the budget
            best = max(matching, key=lambda x: x["event_recall"])
        else:
            best = curve_points[-1]
        budget_results.append(dict(
            target_max_budget=budget,
            operating_point=best
        ))

    return budget_results


def bootstrap_clinical_metrics(test_df, y_prob, threshold, outcomes, n_bootstraps=500, seed=2026):
    """Patient-level cluster bootstrap for core clinical metrics."""
    rng = np.random.default_rng(seed)
    pids = np.unique(test_df.patient_id.to_numpy())
    n_pts = len(pids)
    pid_indices = {pid: np.where(test_df.patient_id.to_numpy() == pid)[0] for pid in pids}

    events = outcomes.set_index("patient_id").event_day.to_dict()
    y_true_all = test_df.target.to_numpy()

    aucs, pr_aucs, briers, senss, specs, ev_senss, fa_rates, leads = [], [], [], [], [], [], [], []

    for _ in range(n_bootstraps):
        sampled_pids = rng.choice(pids, size=n_pts, replace=True)
        sampled_idx = np.concatenate([pid_indices[pid] for pid in sampled_pids])

        y_true = y_true_all[sampled_idx]
        if len(np.unique(y_true)) < 2:
            continue
        p = y_prob[sampled_idx]
        alerts = p >= threshold

        aucs.append(roc_auc_score(y_true, p))
        pr_aucs.append(average_precision_score(y_true, p))
        briers.append(brier_score_loss(y_true, p))

        tn, fp, fn, tp = confusion_matrix(y_true, alerts, labels=[0, 1]).ravel()
        senss.append(tp / max(1, tp + fn))
        specs.append(tn / max(1, tn + fp))

        # False episodes and event sensitivity on sample
        sub_df = pd.DataFrame(dict(patient_id=test_df.patient_id.to_numpy()[sampled_idx],
                                   day=test_df.day.to_numpy()[sampled_idx],
                                   target=y_true, alert=alerts))
        false_episodes = 0
        detected = 0
        sample_events = 0
        lead_list = []

        for pid, hist in sub_df.groupby("patient_id"):
            hist = hist.sort_values("day")
            prev = False
            for r in hist.itertuples():
                if r.alert and not prev and not r.target:
                    false_episodes += 1
                prev = r.alert
            ev = events.get(pid)
            if pd.notna(ev):
                sample_events += 1
                t_alerts = hist[(hist.target == 1) & hist.alert]
                if len(t_alerts):
                    detected += 1
                    lead_list.append(float(ev - t_alerts.day.min()))

        fa_rates.append(false_episodes / (len(sub_df) / 30.0))
        ev_senss.append(detected / max(1, sample_events))
        if lead_list:
            leads.append(float(np.mean(lead_list)))

    def summary(arr):
        if not arr:
            return dict(mean=None, ci_lower=None, ci_upper=None)
        arr = np.array(arr)
        return dict(
            mean=float(np.mean(arr)),
            ci_lower=float(np.percentile(arr, 2.5)),
            ci_upper=float(np.percentile(arr, 97.5))
        )

    return dict(
        roc_auc=summary(aucs),
        pr_auc=summary(pr_aucs),
        brier=summary(briers),
        daily_sensitivity=summary(senss),
        daily_specificity=summary(specs),
        event_sensitivity=summary(ev_senss),
        false_alerts_per_month=summary(fa_rates),
        mean_lead_days=summary(leads)
    )


def run_clinical_evaluation(model_dir=ARTIFACTS, n_bootstraps=500, output_path=None):
    """Run full clinician-relevant evaluation pipeline on the held-out test split."""
    model = RiskModel(model_dir)
    cfg = load_config()
    cfg["seed"] = model.meta["seed"]

    # Recreate the exact benchmark cohort and splits
    patients, observations, outcomes = generate_cohort(n=None, config=cfg)
    dataset = build_dataset(patients, observations, outcomes, cfg)
    splits = split_patients(outcomes, model.meta["seed"])

    test_ids = splits["test"]
    test_df = dataset[dataset.patient_id.isin(test_ids)].copy().reset_index(drop=True)
    test_outcomes = outcomes[outcomes.patient_id.isin(test_ids)].copy()

    # Predict with frozen model
    features_df = test_df[model.meta["features"]].astype(float)
    import xgboost as xgb
    dmatrix = xgb.DMatrix(features_df, feature_names=model.meta["features"])
    margins = model.booster.predict(dmatrix, output_margin=True)
    a, b = model.meta["calibration"]["slope"], model.meta["calibration"]["intercept"]
    y_prob = np.asarray(sigmoid(a * margins + b), dtype=float)

    threshold = model.meta["threshold"]

    print("Computing calibration metrics (ECE)...", flush=True)
    ece_report = compute_ece(test_df.target.to_numpy(), y_prob)

    print("Auditing decompensation event outcomes...", flush=True)
    audit = event_audit(test_df, y_prob, threshold, test_outcomes)

    print("Computing clinician alert budget operating points...", flush=True)
    budgets = alert_budget_curve(test_df, y_prob, test_outcomes)

    print(f"Executing {n_bootstraps} patient bootstrap iterations...", flush=True)
    bootstrap_results = bootstrap_clinical_metrics(test_df, y_prob, threshold, test_outcomes, n_bootstraps=n_bootstraps)

    report = dict(
        synthetic=True,
        clinical_validation=False,
        note="Demonstration of remote telemetry monitoring evaluation. Not validated for clinical diagnosis or treatment guidance.",
        seed=model.meta["seed"],
        threshold=threshold,
        test_cohort=dict(
            n_patients=len(test_ids),
            n_observations=len(test_df),
            positive_rate=float(test_df.target.mean()),
            total_events=audit["total_test_events"]
        ),
        confidence_intervals_95=bootstrap_results,
        calibration=dict(
            ece=ece_report["ece"],
            mce=ece_report["mce"],
            slope=a,
            intercept=b,
            bins=ece_report["bins"]
        ),
        alert_budget_operating_points=budgets,
        event_audit=dict(
            total_events=audit["total_test_events"],
            detected_events=audit["detected_events"],
            missed_events=audit["missed_events"],
            event_recall=audit["event_recall"],
            mean_lead_days=audit["mean_lead_days"],
            per_patient_events=audit["events"]
        )
    )

    if output_path:
        out_p = Path(output_path)
        out_p.parent.mkdir(parents=True, exist_ok=True)
        out_p.write_text(json.dumps(report, indent=2))
        print(f"Saved clinical evaluation report to: {out_p}")

    return report
