import numpy as np
import pandas as pd
from pandas.testing import assert_frame_equal
from cardiotwin.config import load_config
from cardiotwin.features import baseline_for, build_dataset, features_at
from cardiotwin.simulation import generate_cohort

def test_determinism(cohort):
    for actual, expected in zip(generate_cohort(n=12, seed=123), cohort):
        assert_frame_equal(actual, expected)

def test_sensor_bounds_and_no_post_event_data(cohort):
    _, observations, outcomes = cohort
    for key, spec in load_config()["signals"].items():
        assert observations[key].dropna().between(*spec["bounds"]).all()
    for row in outcomes.dropna(subset=["event_day"]).itertuples():
        assert observations[observations.patient_id==row.patient_id].day.max() < row.event_day

def test_past_features_do_not_change_when_future_changes(cohort):
    patients, observations, _ = cohort
    patient=patients.iloc[0].to_dict()
    history=observations[observations.patient_id==patient["patient_id"]].copy()
    expected,_=features_at(patient,history,20)
    history.loc[history.day>20,"weight"]=150
    actual,_=features_at(patient,history,20)
    np.testing.assert_allclose(list(expected.values()),list(actual.values()),equal_nan=True)

def test_constant_baseline_has_finite_scale(cohort):
    patients, observations, _ = cohort
    history=observations[observations.patient_id==patients.iloc[0].patient_id].copy()
    history.loc[history.day<=14,"weight"]=70
    result=baseline_for(history)
    assert result["weight"]["mad_scale"]==load_config()["signals"]["weight"]["scale_floor"]
    assert result["weight"]["median"]==70

def test_missing_baseline_is_not_imputed_from_future(cohort):
    patients, observations, _ = cohort
    history=observations[observations.patient_id==patients.iloc[0].patient_id].copy()
    history.loc[history.day<=14,"weight"]=np.nan
    features, baseline=features_at(patients.iloc[0].to_dict(),history,20)
    assert not baseline["weight"]["ready"]
    assert np.isnan(features["weight_deviation"])

def test_labels_censoring_and_no_target_inputs(cohort):
    patients, observations, outcomes=cohort
    dataset=build_dataset(patients,observations,outcomes)
    for row in dataset.itertuples():
        outcome=outcomes[outcomes.patient_id==row.patient_id].iloc[0]
        expected=int(pd.notna(outcome.event_day) and row.day<outcome.event_day<=row.day+7)
        assert row.target==expected
        assert row.target or row.day+7<=outcome.followup_day
        assert row.day>14
    assert not {"event_day","scenario","followup_day"}&set(dataset.columns)

def test_batch_and_live_feature_contract(cohort):
    patients,observations,outcomes=cohort
    batch=build_dataset(patients,observations,outcomes)
    for row in batch.iloc[::27].to_dict("records"):
        patient=patients[patients.patient_id==row["patient_id"]].iloc[0].to_dict()
        history=observations[observations.patient_id==row["patient_id"]]
        features,_=features_at(patient,history,row["day"])
        for key,value in features.items():
            np.testing.assert_allclose(value,row[key],rtol=1e-6,atol=1e-6,equal_nan=True)
