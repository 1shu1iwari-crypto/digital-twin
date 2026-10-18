import numpy as np
import pandas as pd
import pytest
from cardiotwin.fusion import (
    INTERACTION_FEATURE_NAMES,
    HierarchicalEHRFusion,
    add_interaction_features,
    patient_bootstrap_ci,
    run_paired_fusion_benchmark,
)
from cardiotwin.simulation import STATIC_FEATURES

def test_interaction_features_computed(cohort):
    patients, observations, _ = cohort
    base = pd.concat([patients.iloc[0:1]] * 5, ignore_index=True)
    base["day"] = range(1, 6)
    base["weight_deviation"] = [0.5, 1.2, 2.0, 3.1, 4.0]
    base["resting_hr_deviation"] = [1.0, 2.0, 3.0, 4.0, 5.0]
    base["respiratory_rate_deviation"] = [0.2, 0.4, 0.6, 0.8, 1.0]
    base["systolic_bp_deviation"] = [-2.0, -4.0, 5.0, 10.0, 15.0]

    with_inter = add_interaction_features(base)
    for col in INTERACTION_FEATURE_NAMES:
        assert col in with_inter.columns
        assert np.isfinite(with_inter[col]).all()

def test_hierarchical_fusion_fit_and_bounded():
    rng = np.random.default_rng(42)
    n = 60
    train_data = pd.DataFrame({col: rng.normal(0, 1, n) for col in STATIC_FEATURES})
    train_data["steps_mean_7"] = rng.normal(0, 1, n)
    train_data["target"] = rng.choice([0, 1], size=n, p=[0.7, 0.3])

    val_data = pd.DataFrame({col: rng.normal(0, 1, 30) for col in STATIC_FEATURES})
    val_data["steps_mean_7"] = rng.normal(0, 1, 30)
    val_data["target"] = rng.choice([0, 1], size=30, p=[0.7, 0.3])

    fusion = HierarchicalEHRFusion(random_state=42)
    fusion.fit(train_data, val_data, telemetry_features=["steps_mean_7"])

    test_data = pd.DataFrame({col: rng.normal(0, 1, 20) for col in STATIC_FEATURES})
    test_data["steps_mean_7"] = rng.normal(0, 1, 20)
    probs = fusion.predict_proba(test_data)

    assert len(probs) == 20
    assert (probs >= 0.0).all() and (probs <= 1.0).all()

def test_patient_bootstrap_ci_paired():
    test_df = pd.DataFrame({
        "patient_id": ["P1", "P1", "P2", "P2", "P3", "P3", "P4", "P4"],
        "target": [0, 0, 0, 1, 0, 0, 1, 1]
    })
    y_prob_a = np.array([0.1, 0.1, 0.2, 0.5, 0.1, 0.2, 0.6, 0.7])
    y_prob_b = np.array([0.1, 0.2, 0.1, 0.6, 0.1, 0.1, 0.7, 0.8])

    ci = patient_bootstrap_ci(test_df, y_prob_a, y_prob_b, n_bootstraps=50)
    assert "delta_auc" in ci and "delta_pr_auc" in ci and "delta_brier" in ci
    assert ci["delta_auc"]["low"] <= ci["delta_auc"]["high"]

def test_fusion_benchmark_identical_patients():
    report = run_paired_fusion_benchmark(n=50, seed=4026, n_bootstraps=30)
    assert len(report["models"]) == 5
    assert len(report["test_patient_ids"]) > 0
    for m in report["models"]:
        assert 0.0 <= m["metrics"]["roc_auc"] <= 1.0
