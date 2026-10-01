"""Patient-disjoint evaluation, validation-only calibration, native TreeSHAP."""
import hashlib
import json
from pathlib import Path
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.calibration import calibration_curve
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, confusion_matrix, f1_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from .config import ARTIFACTS, load_config
from .features import build_dataset
from .simulation import generate_cohort, STATIC_FEATURES

def sigmoid(value):
    return 1 / (1 + np.exp(-np.clip(value, -35, 35)))

def split_patients(outcomes, seed=2026):
    ids = outcomes.patient_id.to_numpy()
    labels = outcomes.event_day.notna().astype(int).to_numpy()
    train, held = train_test_split(ids, test_size=.3, random_state=seed, stratify=labels)
    held_labels = outcomes.set_index("patient_id").loc[held].event_day.notna().astype(int)
    val, test = train_test_split(held, test_size=.5, random_state=seed+1, stratify=held_labels)
    return dict(train=list(train), validation=list(val), test=list(test))

def metrics(frame, probabilities, threshold, outcomes):
    target = frame.target.to_numpy()
    alerts = probabilities >= threshold
    tn, fp, fn, tp = confusion_matrix(target, alerts, labels=[0, 1]).ravel()
    scored = frame[["patient_id", "day", "target"]].copy()
    scored["alert"] = alerts
    false_episodes = 0
    lead_times = []
    events = outcomes.set_index("patient_id").event_day.to_dict()
    event_count = 0
    for pid, history in scored.groupby("patient_id"):
        history = history.sort_values("day")
        previous = False
        for row in history.itertuples():
            if row.alert and not previous and not row.target:
                false_episodes += 1
            previous = row.alert
        event = events[pid]
        if pd.notna(event):
            event_count += 1
            true_alerts = history[(history.target == 1) & history.alert]
            if len(true_alerts):
                lead_times.append(float(event - true_alerts.day.min()))
    observed, predicted = calibration_curve(target, probabilities, n_bins=8, strategy="quantile")
    return dict(roc_auc=float(roc_auc_score(target, probabilities)),
                pr_auc=float(average_precision_score(target, probabilities)),
                brier=float(brier_score_loss(target, probabilities)),
                sensitivity=float(tp/max(1, tp+fn)), specificity=float(tn/max(1, tn+fp)),
                false_alerts_per_patient_month=float(false_episodes / (len(frame)/30)),
                event_sensitivity=len(lead_times)/max(1, event_count),
                mean_lead_days=float(np.mean(lead_times)) if lead_times else None,
                detected_events=len(lead_times), total_events=event_count,
                calibration=[dict(predicted=float(p), observed=float(o)) for p, o in zip(predicted, observed)])

def select_threshold(y, probabilities):
    candidates = np.linspace(.05, .95, 91)
    return float(max(candidates, key=lambda t: f1_score(y, probabilities >= t, zero_division=0)))

def train(output=ARTIFACTS, n=None, seed=None):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    cfg = load_config()
    if seed is not None:
        cfg["seed"] = seed
    patients, observations, outcomes = generate_cohort(n, config=cfg)
    print(f"Generated {len(patients)} synthetic patients / {len(observations)} daily observations", flush=True)
    dataset = build_dataset(patients, observations, outcomes, cfg)
    splits = split_patients(outcomes, cfg["seed"])
    frames = {k: dataset[dataset.patient_id.isin(ids)].copy() for k, ids in splits.items()}
    all_features = [c for c in dataset.columns if c not in ["patient_id", "day", "target"]]
    current = [c for c in all_features if c.endswith("_current")]
    temporal = [c for c in all_features if c not in STATIC_FEATURES and not c.endswith("_deviation")]
    groups = {
        "EHR logistic": (STATIC_FEATURES, "logistic"),
        "EHR only": (STATIC_FEATURES, "xgb"),
        "Wearable only": (temporal, "xgb"),
        "EHR + wearable": (STATIC_FEATURES + temporal, "xgb"),
        "No temporal features": (STATIC_FEATURES + current + [c for c in all_features if c.endswith("_deviation")], "xgb"),
        "Personalized CardioTwin": (all_features, "xgb"),
    }
    report = dict(synthetic=True, clinical_validation=False, seed=cfg["seed"],
                  n_patients=len(patients), n_observations=len(observations), n_samples=len(dataset),
                  positive_fraction=float(dataset.target.mean()),
                  split_counts={k: len(v) for k, v in splits.items()}, models=[])
    for name, (columns, kind) in groups.items():
        print(f"Training {name}...", flush=True)
        if kind == "logistic":
            model = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(max_iter=500))
            model.fit(frames["train"][columns], frames["train"].target)
            val_margin = model.decision_function(frames["validation"][columns])
            test_margin = model.decision_function(frames["test"][columns])
        else:
            model = xgb.XGBClassifier(n_estimators=180, max_depth=3, learning_rate=.055,
                                      subsample=.85, colsample_bytree=.8, min_child_weight=12,
                                      reg_lambda=3, objective="binary:logistic", n_jobs=2,
                                      random_state=cfg["seed"], tree_method="hist")
            model.fit(frames["train"][columns], frames["train"].target)
            val_margin = model.predict(frames["validation"][columns], output_margin=True)
            test_margin = model.predict(frames["test"][columns], output_margin=True)
        # No test outcomes used to select calibration or operating threshold.
        calibrator = LogisticRegression(C=100, max_iter=300).fit(np.asarray(val_margin).reshape(-1,1), frames["validation"].target)
        a, b = float(calibrator.coef_[0,0]), float(calibrator.intercept_[0])
        val_p = sigmoid(a * val_margin + b)
        test_p = sigmoid(a * test_margin + b)
        threshold = select_threshold(frames["validation"].target, val_p)
        measured = metrics(frames["test"], test_p, threshold, outcomes)
        report["models"].append(dict(name=name, feature_count=len(columns), threshold=threshold, **measured))
        if name == "Personalized CardioTwin":
            model.save_model(output / "risk_model.json")
            metadata = dict(features=columns, calibration=dict(slope=a, intercept=b), threshold=threshold,
                            seed=cfg["seed"], synthetic=True, baseline_days=cfg["baseline_days"],
                            config_sha256=hashlib.sha256(json.dumps(cfg, sort_keys=True).encode()).hexdigest())
            (output / "metadata.json").write_text(json.dumps(metadata, indent=2))
    (output / "evaluation.json").write_text(json.dumps(report, indent=2))
    (output / "splits.json").write_text(json.dumps(splits, indent=2))
    return report

class RiskModel:
    def __init__(self, directory=ARTIFACTS):
        directory = Path(directory)
        self.meta = json.loads((directory / "metadata.json").read_text())
        cfg = load_config()
        config_hash = hashlib.sha256(json.dumps({**cfg, "seed": self.meta["seed"]}, sort_keys=True).encode()).hexdigest()
        if config_hash != self.meta["config_sha256"]:
            raise ValueError("Simulation/feature configuration changed; retrain before inference")
        self.booster = xgb.Booster()
        self.booster.load_model(directory / "risk_model.json")
        self.booster.set_param({"nthread": 2})

    def predict(self, features, explain=True):
        data = pd.DataFrame([features]).reindex(columns=self.meta["features"]).astype(float)
        matrix = xgb.DMatrix(data, feature_names=self.meta["features"])
        margin = float(self.booster.predict(matrix, output_margin=True)[0])
        a, b = self.meta["calibration"]["slope"], self.meta["calibration"]["intercept"]
        risk = float(sigmoid(a * margin + b))
        result = dict(probability=risk, horizon_days=7, synthetic=True, threshold=self.meta["threshold"])
        if explain:
            contributions = self.booster.predict(matrix, pred_contribs=True)[0]
            values = [dict(feature=name, contribution=float(a * value), value=float(data[name].iloc[0]) if pd.notna(data[name].iloc[0]) else None)
                      for name, value in zip(self.meta["features"], contributions[:-1])]
            result["explanation"] = dict(method="TreeSHAP", units="calibrated log-odds", base_value=float(a * contributions[-1] + b),
                                           contributions=sorted(values, key=lambda x: abs(x["contribution"]), reverse=True),
                                           log_odds=float(a * margin + b))
        return result
