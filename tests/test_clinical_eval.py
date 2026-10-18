import numpy as np
import pandas as pd
import pytest
from cardiotwin.clinical_eval import (
    alert_budget_curve,
    bootstrap_clinical_metrics,
    compute_ece,
    event_audit,
)

def test_compute_ece_perfect_and_imperfect():
    # Perfect calibration: predicted 0.8 on 80% positives, 0.2 on 20% positives
    y_true = np.array([1]*80 + [0]*20 + [1]*20 + [0]*80)
    y_prob = np.array([0.8]*100 + [0.2]*100)
    res = compute_ece(y_true, y_prob, n_bins=5)
    assert res["ece"] < 0.05
    assert 0.0 <= res["ece"] <= 1.0
    assert 0.0 <= res["mce"] <= 1.0

def test_event_audit_accounts_for_all_events():
    test_df = pd.DataFrame({
        "patient_id": ["P1", "P1", "P2", "P2", "P3"],
        "day": [20, 25, 20, 25, 20],
        "target": [0, 1, 0, 0, 0]
    })
    y_prob = np.array([0.1, 0.8, 0.2, 0.3, 0.1])
    outcomes = pd.DataFrame([
        {"patient_id": "P1", "event_day": 28, "scenario": "deteriorating"},
        {"patient_id": "P2", "event_day": None, "scenario": "stable"},
        {"patient_id": "P3", "event_day": 30, "scenario": "deteriorating"},
    ])

    audit = event_audit(test_df, y_prob, threshold=0.5, outcomes=outcomes)
    assert audit["total_test_events"] == 2
    assert audit["detected_events"] == 1
    assert audit["missed_events"] == 1
    assert audit["event_recall"] == 0.5
    assert audit["mean_lead_days"] == 3.0  # 28 - 25

def test_alert_budget_curve_monotonicity():
    # 5 patients across 30 days = 5 patient-months
    test_df = pd.DataFrame({
        "patient_id": [f"P{i}" for i in range(5) for _ in range(30)],
        "day": list(range(1, 31)) * 5,
        "target": [0]*145 + [1]*5
    })
    y_prob = np.linspace(0.05, 0.95, 150)
    outcomes = pd.DataFrame([
        {"patient_id": f"P{i}", "event_day": 28 if i == 4 else None, "scenario": "deteriorating" if i == 4 else "stable"}
        for i in range(5)
    ])

    budgets = alert_budget_curve(test_df, y_prob, outcomes, target_budgets=(0.2, 0.5, 1.0))
    assert len(budgets) == 3
    for b in budgets:
        assert b["operating_point"]["false_alerts_per_month"] <= b["target_max_budget"] + 0.1
    # Tighter budget must require equal or higher threshold
    t_tight = budgets[0]["operating_point"]["threshold"]
    t_loose = budgets[2]["operating_point"]["threshold"]
    assert t_tight >= t_loose

def test_bootstrap_clinical_metrics_bounds():
    test_df = pd.DataFrame({
        "patient_id": ["P1", "P1", "P2", "P2", "P3", "P3", "P4", "P4"],
        "day": [15, 20, 15, 20, 15, 20, 15, 20],
        "target": [0, 1, 0, 0, 0, 1, 0, 0]
    })
    y_prob = np.array([0.1, 0.7, 0.2, 0.3, 0.1, 0.8, 0.1, 0.2])
    outcomes = pd.DataFrame([
        {"patient_id": "P1", "event_day": 22},
        {"patient_id": "P2", "event_day": None},
        {"patient_id": "P3", "event_day": 23},
        {"patient_id": "P4", "event_day": None},
    ])

    ci = bootstrap_clinical_metrics(test_df, y_prob, threshold=0.5, outcomes=outcomes, n_bootstraps=30)
    assert 0.0 <= ci["roc_auc"]["mean"] <= 1.0
    assert ci["roc_auc"]["ci_lower"] <= ci["roc_auc"]["ci_upper"]
