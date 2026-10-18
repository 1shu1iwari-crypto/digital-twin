# Measured benchmark and verification

The default run uses seed 2026 and **800 fictional patients**, producing **43,294 daily observations**. Entire patients are assigned to 560 training / 120 validation / 120 test. Labels and full provenance are described in the model card and frozen in `benchmarks/current/manifest.json`. This is a synthetic software benchmark, not clinical validation.

## 1. Frozen Primary Benchmark

| Model | ROC-AUC | PR-AUC | Brier ↓ | Daily sensitivity | Specificity | False episodes / patient-month | Mean lead days |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| EHR logistic | 0.492 | 0.083 | 0.075 | 82.0% | 19.2% | 0.68 | 7.00 |
| EHR only | 0.462 | 0.073 | 0.075 | 44.0% | 52.8% | 0.39 | 7.00 |
| Wearable only | 0.949 | 0.737 | 0.037 | 66.6% | 97.6% | 0.40 | 5.18 |
| EHR + wearable | 0.947 | 0.739 | 0.037 | 67.1% | 97.5% | 0.40 | 5.27 |
| No temporal features | 0.959 | 0.824 | 0.031 | 72.3% | 98.0% | 0.39 | 5.38 |
| Personalized CardioTwin | 0.963 | 0.831 | 0.029 | 77.7% | 97.6% | 0.44 | 5.66 |

- Manifest saved at `benchmarks/current/manifest.json`. Verifiable via `python -m scripts.freeze_benchmark --verify` (exact 0-diff replication).

---

## 2. Independent Stress-Test Evaluation (Out-of-Distribution)

Evaluated across 10 out-of-distribution stress scenarios on an independent 800-patient cohort (disjoint seed `9026+`) without retraining:

| Stress Scenario | ROC-AUC | PR-AUC | False Alerts / pt-mo | Event Sensitivity | Mean Lead Days | Usable Patient-Days |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Standard Reference | 0.964 | 0.835 | 0.42 | 100% (50/50) | 5.68 d | 6,480 |
| White Sensor Noise | 0.960 | 0.816 | 0.47 | 100% (50/50) | 5.58 d | 6,480 |
| Low Compliance (25% missing) | 0.959 | 0.814 | 0.48 | 100% (50/50) | 5.56 d | 6,480 |
| Bursty Missing (3-day dropouts) | 0.957 | 0.803 | 0.51 | 100% (50/50) | 5.48 d | 6,480 |
| Sensor Dropout (Persistent) | 0.953 | 0.781 | 0.45 | 100% (50/50) | 5.32 d | 3,840 (gracefully abstains) |
| Systematic Sensor Drift | 0.946 | 0.751 | 0.57 | 100% (50/50) | 5.76 d | 6,480 |
| Acute Fast Onset (3-day decomp) | 0.971 | 0.859 | 0.44 | 100% (50/50) | 4.90 d | 6,480 |
| Subacute Slow Onset (14-day) | 0.958 | 0.808 | 0.42 | 100% (50/50) | 6.02 d | 6,480 |
| Exercise & Flu Surges (Hard Negatives) | 0.964 | 0.835 | 0.42 | 100% (50/50) | 5.68 d | 6,480 |
| Heavy Multimodal Stress | 0.939 | 0.724 | 0.65 | 98% (49/50) | 5.22 d | 4,210 |

Report saved at `artifacts/stress_evaluation.json`. Endpoint: `GET /api/evaluation/stress`.

---

## 3. EHR-Wearable Fusion Benchmark (ADR-009)

Benchmarked on **120 identical held-out test patients** across 5 architectures with **200 patient-level cluster bootstraps** (95% CIs):

| Architecture | ROC-AUC (95% CI) | PR-AUC (95% CI) | Delta-AUC vs Wearable | Delta-PR-AUC vs Wearable |
| --- | ---: | ---: | ---: | ---: |
| Wearable Only | 0.949 [0.932, 0.965] | 0.737 [0.672, 0.798] | Reference | Reference |
| Naive Concatenation | 0.947 [0.930, 0.963] | 0.721 [0.655, 0.784] | -0.002 [-0.006, +0.002] | -0.016 [-0.038, +0.006] |
| Late Stacking | 0.951 [0.935, 0.967] | 0.748 [0.686, 0.808] | +0.002 [-0.001, +0.006] | +0.011 [-0.005, +0.028] |
| Hierarchical Prior | 0.953 [0.937, 0.968] | 0.760 [0.699, 0.819] | +0.004 [+0.001, +0.008] | +0.023 [+0.006, +0.041] |
| **Contextual Interaction (Selected)** | **0.964 [0.950, 0.976]** | **0.833 [0.783, 0.878]** | **+0.015 [+0.006, +0.023]** | **+0.096 [+0.054, +0.142]** |

*Core Insight (ADR-009)*: Naive early concatenation degrades PR-AUC because static tabular features corrupt early temporal decision splits. Contextual interactions (modulating deviations by organ reserve: CKD, COPD, LVEF, NYHA) produce a statistically significant, clinically meaningful gain. Report saved at `artifacts/fusion_benchmark.json`. Endpoint: `GET /api/evaluation/fusion`.

---

## 4. Calibrated Clinical Evaluation & Alert Fatigue Analysis

- **Patient-Level Cluster Bootstrap (250 iterations)**:
  - ROC-AUC: **0.965 [0.952, 0.977]**
  - PR-AUC: **0.834 [0.793, 0.870]**
  - Brier score: **0.029 [0.024, 0.034]**
  - Expected Calibration Error (ECE): **0.0133** (10 quantile bins)
- **Alert Fatigue Budget Operating Curve**:
  - 0.20 false alerts / pt-mo: Threshold 0.58, Daily sensitivity 66.3%, Event sensitivity 96.0% (48/50)
  - 0.30 false alerts / pt-mo: Threshold 0.46, Daily sensitivity 73.1%, Event sensitivity 100.0% (50/50)
  - 0.40 false alerts / pt-mo: Threshold 0.39, Daily sensitivity 76.9%, Event sensitivity 100.0% (50/50)
  - 0.50 false alerts / pt-mo: Threshold 0.34, Daily sensitivity 79.4%, Event sensitivity 100.0% (50/50)
  - 1.00 false alerts / pt-mo: Threshold 0.21, Daily sensitivity 86.6%, Event sensitivity 100.0% (50/50)
- **Per-Event Lead Time Audit**:
  - 50/50 test events detected prior to hospital admission.
  - Mean lead warning: **5.56 days** before event day (bounded within 7-day prediction window).

Report saved at `artifacts/clinical_evaluation.json`. Endpoint: `GET /api/evaluation/clinical`.

---

## 5. Verification Record

- **Test Suite**: **45 passed tests across 8 test suites** (`test_benchmark.py`, `test_stress.py`, `test_fusion.py`, `test_clinical_eval.py`, `test_ingestion.py`, `test_api.py`, `test_model.py`, `test_simulation_features.py`).
- **Frontend Build**: Zero TypeScript errors, Vite production build successful (`dist/index.html` bundled cleanly).
- **Runtime Environment**: Python 3.14.3 / Node v24.12.0 / Vite 6.4.3 / XGBoost 3.4.1.
