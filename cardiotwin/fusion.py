"""Hierarchical EHR fusion and paired benchmarking against wearable-only models.

Demonstrates the incremental prognostic value of static EHR profiles over dynamic wearable
telemetry when evaluated on identical test patients and identical daily observation rows.
"""
import hashlib
import json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
import xgboost as xgb

from .config import ARTIFACTS, load_config
from .features import build_dataset
from .model import XGB_PARAMS, metrics, select_threshold, sigmoid, split_patients
from .simulation import STATIC_FEATURES, generate_cohort


INTERACTION_FEATURE_NAMES = [
    "congestion_ckd_risk",
    "autonomic_nyha_risk",
    "respiratory_copd_risk",
    "hemodynamic_lvef_risk",
]


def add_interaction_features(df):
    """Add causal clinical-telemetry interaction terms without future leakage.

    Clinical context modulates physiological deviations: an elevated respiratory rate
    or weight increase represents higher decompensation risk in patients with low LVEF,
    CKD, or advanced NYHA class.
    """
    out = df.copy()
    ckd = out["ckd"].fillna(0).astype(float)
    copd = out["copd"].fillna(0).astype(float)
    nyha = out["nyha"].fillna(2).astype(float)
    lvef = out["lvef"].fillna(45).clip(20, 60).astype(float)

    weight_dev = out["weight_deviation"].fillna(0).astype(float)
    hr_dev = out["resting_hr_deviation"].fillna(0).astype(float)
    resp_dev = out["respiratory_rate_deviation"].fillna(0).astype(float)
    bp_dev = out["systolic_bp_deviation"].fillna(0).astype(float)

    out["congestion_ckd_risk"] = weight_dev * (1.0 + 0.6 * ckd)
    out["autonomic_nyha_risk"] = hr_dev * (nyha / 2.0)
    out["respiratory_copd_risk"] = resp_dev * (1.0 + 0.5 * copd)
    out["hemodynamic_lvef_risk"] = bp_dev.abs() * (45.0 / lvef)
    return out


class HierarchicalEHRFusion:
    """Stacked two-stage fusion model.

    Stage 1:
      - Static EHR model: captures baseline clinical vulnerability prior (log-odds).
      - Dynamic wearable model: captures physiological deviations and trends.
    Stage 2:
      - Meta-combiner fit strictly on validation data to combine prior and likelihood.
    """

    def __init__(self, random_state=2026):
        self.random_state = random_state
        self.ehr_model = make_pipeline(
            SimpleImputer(strategy="median"),
            StandardScaler(),
            LogisticRegression(C=1.0, max_iter=500, random_state=random_state)
        )
        self.telemetry_model = None
        self.combiner = LogisticRegression(C=10.0, max_iter=300, random_state=random_state)
        self.telemetry_features = None
        self.threshold = 0.5

    def fit(self, train_df, val_df, telemetry_features):
        self.telemetry_features = list(telemetry_features)

        # 1. Fit Stage 1 static EHR on train
        self.ehr_model.fit(train_df[STATIC_FEATURES], train_df.target)

        # 2. Fit Stage 1 dynamic wearable on train
        self.telemetry_model = xgb.XGBClassifier(**XGB_PARAMS, random_state=self.random_state)
        self.telemetry_model.fit(train_df[self.telemetry_features], train_df.target)

        # 3. Predict margins on validation split (strictly preventing test leakage)
        val_ehr_margin = self.ehr_model.decision_function(val_df[STATIC_FEATURES]).reshape(-1, 1)
        val_tel_margin = self.telemetry_model.predict(val_df[self.telemetry_features], output_margin=True).reshape(-1, 1)
        val_meta_X = np.hstack([val_tel_margin, val_ehr_margin])

        # 4. Fit Stage 2 combiner on validation
        self.combiner.fit(val_meta_X, val_df.target)

        # 5. Select operating threshold on validation
        val_probs = self.predict_proba_margins(val_meta_X)
        self.threshold = select_threshold(val_df.target, val_probs)
        return self

    def predict_proba_margins(self, meta_X):
        logits = self.combiner.decision_function(meta_X)
        return sigmoid(logits)

    def predict_proba(self, df):
        ehr_margin = self.ehr_model.decision_function(df[STATIC_FEATURES]).reshape(-1, 1)
        tel_margin = self.telemetry_model.predict(df[self.telemetry_features], output_margin=True).reshape(-1, 1)
        meta_X = np.hstack([tel_margin, ehr_margin])
        return self.predict_proba_margins(meta_X)


def patient_bootstrap_ci(test_df, y_prob_a, y_prob_b, n_bootstraps=1000, seed=2026):
    """Compute patient-level bootstrap 95% confidence intervals for paired delta metrics.

    Resamples distinct patient IDs to account for within-patient daily observation correlation.
    """
    rng = np.random.default_rng(seed)
    patient_ids = np.unique(test_df.patient_id.to_numpy())
    n_patients = len(patient_ids)

    # Pre-index patient row indices
    patient_indices = {pid: np.where(test_df.patient_id.to_numpy() == pid)[0] for pid in patient_ids}

    delta_aucs = []
    delta_pr_aucs = []
    delta_briers = []

    y_true_all = test_df.target.to_numpy()

    for _ in range(n_bootstraps):
        sampled_pids = rng.choice(patient_ids, size=n_patients, replace=True)
        sampled_idx = np.concatenate([patient_indices[pid] for pid in sampled_pids])

        y_true = y_true_all[sampled_idx]
        if len(np.unique(y_true)) < 2:
            continue

        p_a = y_prob_a[sampled_idx]
        p_b = y_prob_b[sampled_idx]

        auc_a = roc_auc_score(y_true, p_a)
        auc_b = roc_auc_score(y_true, p_b)
        pr_a = average_precision_score(y_true, p_a)
        pr_b = average_precision_score(y_true, p_b)
        brier_a = brier_score_loss(y_true, p_a)
        brier_b = brier_score_loss(y_true, p_b)

        delta_aucs.append(auc_b - auc_a)
        delta_pr_aucs.append(pr_b - pr_a)
        delta_briers.append(brier_a - brier_b)  # positive means b is lower (better)

    def ci(arr):
        if not arr:
            return dict(mean=0.0, low=0.0, high=0.0, p_value=0.5)
        arr = np.array(arr)
        return dict(
            mean=float(np.mean(arr)),
            low=float(np.percentile(arr, 2.5)),
            high=float(np.percentile(arr, 97.5)),
            p_superiority=float(np.mean(arr > 0))
        )

    return dict(
        delta_auc=ci(delta_aucs),
        delta_pr_auc=ci(delta_pr_aucs),
        delta_brier=ci(delta_briers),
    )


def run_paired_fusion_benchmark(n=None, seed=None, n_bootstraps=1000):
    """Benchmark EHR fusion architectures against wearable-only on strictly identical test patients."""
    cfg = load_config()
    actual_seed = seed or cfg["seed"]
    cfg["seed"] = actual_seed

    patients, observations, outcomes = generate_cohort(n, config=cfg)
    base_dataset = build_dataset(patients, observations, outcomes, cfg)
    dataset = add_interaction_features(base_dataset)

    splits = split_patients(outcomes, actual_seed)
    frames = {k: dataset[dataset.patient_id.isin(ids)].copy().reset_index(drop=True) for k, ids in splits.items()}

    all_features = [c for c in base_dataset.columns if c not in ["patient_id", "day", "target"]]
    telemetry_features = [c for c in all_features if c not in STATIC_FEATURES and not c.endswith("_deviation")]
    personalized_features = all_features
    interaction_features = personalized_features + INTERACTION_FEATURE_NAMES

    test_outcomes = outcomes[outcomes.patient_id.isin(splits["test"])].copy()

    # 1. Wearable Only (Baseline)
    print("Training Wearable-only baseline...", flush=True)
    m_wear = xgb.XGBClassifier(**XGB_PARAMS, random_state=actual_seed)
    m_wear.fit(frames["train"][telemetry_features], frames["train"].target)
    val_m_wear = m_wear.predict(frames["validation"][telemetry_features], output_margin=True)
    test_m_wear = m_wear.predict(frames["test"][telemetry_features], output_margin=True)
    cal_wear = LogisticRegression(C=100, max_iter=300).fit(val_m_wear.reshape(-1, 1), frames["validation"].target)
    val_p_wear = sigmoid(cal_wear.decision_function(val_m_wear.reshape(-1, 1)))
    test_p_wear = sigmoid(cal_wear.decision_function(test_m_wear.reshape(-1, 1)))
    thresh_wear = select_threshold(frames["validation"].target, val_p_wear)
    metrics_wear = metrics(frames["test"], test_p_wear, thresh_wear, test_outcomes)

    # 2. Static EHR Only
    print("Training Static EHR-only...", flush=True)
    m_ehr = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(max_iter=500, random_state=actual_seed))
    m_ehr.fit(frames["train"][STATIC_FEATURES], frames["train"].target)
    val_m_ehr = m_ehr.decision_function(frames["validation"][STATIC_FEATURES])
    test_m_ehr = m_ehr.decision_function(frames["test"][STATIC_FEATURES])
    cal_ehr = LogisticRegression(C=100, max_iter=300).fit(val_m_ehr.reshape(-1, 1), frames["validation"].target)
    val_p_ehr = sigmoid(cal_ehr.decision_function(val_m_ehr.reshape(-1, 1)))
    test_p_ehr = sigmoid(cal_ehr.decision_function(test_m_ehr.reshape(-1, 1)))
    thresh_ehr = select_threshold(frames["validation"].target, val_p_ehr)
    metrics_ehr = metrics(frames["test"], test_p_ehr, thresh_ehr, test_outcomes)

    # 3. Naive Early Concatenation (EHR + Wearable)
    print("Training Naive Concatenation...", flush=True)
    m_naive = xgb.XGBClassifier(**XGB_PARAMS, random_state=actual_seed)
    naive_cols = STATIC_FEATURES + telemetry_features
    m_naive.fit(frames["train"][naive_cols], frames["train"].target)
    val_m_naive = m_naive.predict(frames["validation"][naive_cols], output_margin=True)
    test_m_naive = m_naive.predict(frames["test"][naive_cols], output_margin=True)
    cal_naive = LogisticRegression(C=100, max_iter=300).fit(val_m_naive.reshape(-1, 1), frames["validation"].target)
    val_p_naive = sigmoid(cal_naive.decision_function(val_m_naive.reshape(-1, 1)))
    test_p_naive = sigmoid(cal_naive.decision_function(test_m_naive.reshape(-1, 1)))
    thresh_naive = select_threshold(frames["validation"].target, val_p_naive)
    metrics_naive = metrics(frames["test"], test_p_naive, thresh_naive, test_outcomes)

    # 4. Hierarchical Stacked Late Fusion
    print("Training Hierarchical Late Fusion...", flush=True)
    m_hier = HierarchicalEHRFusion(random_state=actual_seed)
    m_hier.fit(frames["train"], frames["validation"], telemetry_features=telemetry_features)
    test_p_hier = m_hier.predict_proba(frames["test"])
    metrics_hier = metrics(frames["test"], test_p_hier, m_hier.threshold, test_outcomes)

    # 5. Clinical Interaction Fusion (Personalized + Interaction Terms)
    print("Training Contextual Interaction Fusion...", flush=True)
    m_inter = xgb.XGBClassifier(**XGB_PARAMS, random_state=actual_seed)
    m_inter.fit(frames["train"][interaction_features], frames["train"].target)
    val_m_inter = m_inter.predict(frames["validation"][interaction_features], output_margin=True)
    test_m_inter = m_inter.predict(frames["test"][interaction_features], output_margin=True)
    cal_inter = LogisticRegression(C=100, max_iter=300).fit(val_m_inter.reshape(-1, 1), frames["validation"].target)
    val_p_inter = sigmoid(cal_inter.decision_function(val_m_inter.reshape(-1, 1)))
    test_p_inter = sigmoid(cal_inter.decision_function(test_m_inter.reshape(-1, 1)))
    thresh_inter = select_threshold(frames["validation"].target, val_p_inter)
    metrics_inter = metrics(frames["test"], test_p_inter, thresh_inter, test_outcomes)

    # Compute Paired Patient Bootstrap CIs against Wearable-only baseline
    print(f"Computing {n_bootstraps} patient-level bootstrap iterations...", flush=True)
    ci_naive = patient_bootstrap_ci(frames["test"], test_p_wear, test_p_naive, n_bootstraps, seed=actual_seed)
    ci_hier = patient_bootstrap_ci(frames["test"], test_p_wear, test_p_hier, n_bootstraps, seed=actual_seed + 1)
    ci_inter = patient_bootstrap_ci(frames["test"], test_p_wear, test_p_inter, n_bootstraps, seed=actual_seed + 2)

    report = dict(
        synthetic=True,
        clinical_validation=False,
        seed=actual_seed,
        n_patients=len(patients),
        n_test_patients=len(splits["test"]),
        n_test_observations=len(frames["test"]),
        test_patient_ids=splits["test"],
        models=[
            dict(name="Wearable only (Reference)", features_count=len(telemetry_features), metrics=metrics_wear, paired_delta_vs_wearable=None),
            dict(name="Static EHR only", features_count=len(STATIC_FEATURES), metrics=metrics_ehr, paired_delta_vs_wearable=None),
            dict(name="Naive Early Concatenation", features_count=len(naive_cols), metrics=metrics_naive, paired_delta_vs_wearable=ci_naive),
            dict(name="Hierarchical Late Fusion", features_count=len(STATIC_FEATURES) + len(telemetry_features), metrics=metrics_hier, paired_delta_vs_wearable=ci_hier),
            dict(name="Contextual Interaction Fusion", features_count=len(interaction_features), metrics=metrics_inter, paired_delta_vs_wearable=ci_inter),
        ]
    )

    return report
