import json
import numpy as np
from cardiotwin.features import features_at
from cardiotwin.model import sigmoid

def test_patient_splits_are_disjoint(model_dir):
    splits=json.loads((model_dir/"splits.json").read_text())
    sets=[set(values) for values in splits.values()]
    assert not sets[0]&sets[1] and not sets[0]&sets[2] and not sets[1]&sets[2]
    assert len(set.union(*sets))==80

def test_shap_additivity_matches_calibrated_probability(model,cohort):
    patients, observations, _=cohort
    features,_=features_at(patients.iloc[0].to_dict(),observations[observations.patient_id==patients.iloc[0].patient_id],25)
    result=model.predict(features)
    explanation=result["explanation"]
    total=explanation["base_value"]+sum(item["contribution"] for item in explanation["contributions"])
    np.testing.assert_allclose(total,explanation["log_odds"],atol=1e-5)
    np.testing.assert_allclose(sigmoid(total),result["probability"],atol=1e-5)
    assert explanation["units"]=="calibrated log-odds"

def test_evaluation_is_measured_and_bounded(model_dir):
    report=json.loads((model_dir/"evaluation.json").read_text())
    assert report["synthetic"] and not report["clinical_validation"]
    assert len(report["models"])==6
    for model in report["models"]:
        for key in ["roc_auc","pr_auc","brier","sensitivity","specificity","event_sensitivity"]:
            assert 0<=model[key]<=1
        assert 0<model["threshold"]<1
        if model["mean_lead_days"] is not None:
            assert 1<=model["mean_lead_days"]<=7
    features=json.loads((model_dir/"metadata.json").read_text())["features"]
    assert not {"patient_id","target","day","event_day","scenario"}&set(features)
