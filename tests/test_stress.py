import numpy as np
import pytest
from cardiotwin.stress import generate_stress_cohort, evaluate_stress_scenario, load_stress_config

def test_stress_seeds_and_scenarios(cohort):
    cfg = load_stress_config()
    assert cfg["base_seed"] >= 9000
    p1, obs1, out1 = generate_stress_cohort("high_noise", n=10, seed=9001)
    p2, obs2, out2 = generate_stress_cohort("high_noise", n=10, seed=9002)
    # Different seeds must produce different sensor values or different counts
    assert obs1["weight"].dropna().sum() != obs2["weight"].dropna().sum()
    assert (p1["synthetic"] == True).all()
    assert "stress_scenario" in p1.columns

def test_sensor_dropout_produces_nans():
    _, obs, _ = generate_stress_cohort("weight_sensor_dropout", n=10, seed=9050)
    # Beyond baseline day 14, weight must be entirely NaN
    after_baseline = obs[obs.day > 14]
    assert after_baseline["weight"].isna().all()

def test_stress_evaluation_abstained_and_bounded(model):
    # Test on a small cohort for speed
    res_clean = evaluate_stress_scenario(model, "baseline_reference", n=25, seed=9100)
    assert 0 <= res_clean["abstained_fraction"] <= 1.0
    if res_clean["usable_metrics"]["roc_auc"] is not None:
        assert 0.5 <= res_clean["usable_metrics"]["roc_auc"] <= 1.0

    res_dropout = evaluate_stress_scenario(model, "smartwatch_dropout", n=25, seed=9101)
    # Smartwatch dropout drops multiple sensors -> coverage drops below 0.5 -> high abstention
    assert res_dropout["abstained_fraction"] > res_clean["abstained_fraction"]
