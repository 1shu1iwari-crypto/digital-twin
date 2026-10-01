# Model card

**Version:** 0.1 · **Intended use:** local hackathon engineering demonstration. **Target:** simulated HF hospitalization strictly in the next seven days. No clinical use, diagnoses, treatment advice, medication effects or causal forecasts.

## Training and validation

An 800-patient, 60-day fully synthetic cohort is split by patient: 560 train, 120 validation, 120 test. Train-only fitting applies to logistic imputation/scaling and XGBoost. XGBoost uses 180 depth-3 histogram trees, learning rate .055, row/column subsampling and regularization. All settings are fixed before test evaluation. No deep sequence model is used.

Each model gets a sigmoid calibrator fitted to its raw margin on validation patients, and a validation-F1 operating threshold. Reported test metrics use that operating threshold; the dashboard's 20%/60% categories are independently chosen demo UI conventions. Probabilities are calibrated only against this simulator's label prevalence.

## Explainability

Native TreeSHAP computes XGBoost contributions in margin/log-odds space. If calibrated margin is `a*margin+b`, each contribution becomes `a*contribution`, and the base becomes `a*base+b`. Their sum exactly reconstructs the displayed calibrated margin up to floating-point error; sigmoid returns the risk estimate. Feature associations do not imply clinical causation. Top-feature displays omit small contributions; the full API supplies all of them.

## Metrics

ROC-AUC, average-precision PR-AUC, Brier, sensitivity, specificity and quantile reliability bins are measured on labeled test patient-days. Event sensitivity asks whether there was any above-threshold alert in an event patient's final seven days. Mean lead time uses the earliest such true alert, only among detected events. False alert episodes start when consecutive above-threshold daily observations begin on a negative-label day; rate denominator is evaluated patient-days / 30. These definitions should not be confused with hospital/device trials.

## Data quality

Require a complete first-14-day baseline with at least seven readings per signal, past-week coverage ≥50% and current-day coverage ≥50%. Otherwise return null risk and null indices. The simulator assures a stable initial window; real-world enrollment would need verified stability, device-specific preprocessing and a separate missingness validation study.

## Limitations

Synthetic outcomes and trajectories share an engineered generator. High scores may primarily reflect recognizing its patterns. Static EHR has only a weak event association here, and is not clinically modeled. Calibration is sensitive to simulator prevalence and is not externally validated. Derived twin indices are illustrative bounded summaries, not calibrated measurements. Event detection does not establish reduced hospitalization or improved survival. Test estimates do not include confidence intervals, external validation, demographic fairness audits or temporal dataset-shift analysis in this release.

Next research milestones: an independently designed simulator stress test, bootstrap confidence intervals by patient, device data contracts, properly licensed/credentialed external data, prospective outcome labels and clinical review. Live clinical use would also require authentication, authorization, privacy, audit, encryption and a validated response workflow.
