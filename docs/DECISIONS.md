# Architecture decisions

## ADR-001: target and data provenance
Predict a simulated hospitalization event strictly within the next seven days. Use an in-house fully synthetic EHR/time-series generator. Do not call this semi-synthetic or suggest it contains Synthea/PhysioNet data.

## ADR-002: personal baseline
Freeze each signal's median and MAD using days 1–14, assumed stable in the simulator. Require at least seven non-missing readings per signal. Floors are engineering parameters in config/simulation.yaml. Never adapt the baseline into a deteriorating episode. Real enrollment requires a verified stable window.

## ADR-003: models and leakage prevention
Start with logistic regression and XGBoost. Entire patients stay in one 70/15/15 split. Imputation/scaling for logistic regression fit on training only. XGBoost handles NaNs. Calibration and F1 operating threshold selection use validation only. IDs, day number, event day and scenario tag never enter the model. All features are causal and labels censor incomplete negative future windows.

## ADR-004: explainability
Use XGBoost's native exact tree contribution calculation (TreeSHAP), not invented heuristic contributors. Apply the affine sigmoid-calibration parameters to log-odds contributions and intercept so additivity remains testable. Contributions are not probability-point increments or causal effects.

## ADR-005: meaning of a twin
This release implements a continuously updated data-driven patient state. Five bounded indices summarize deviations. They are illustrative 0–100 scores, not calibrated congestion, autonomic or hemodynamic measurements. Mechanistic cardiovascular models are a separate future research milestone.

## ADR-006: scenarios
Perturb only the latest day's supported sensor inputs, preserve NaNs, recompute all temporal features and predictions, and never persist the scenario. Do not model medication effects or recommend interventions.

## ADR-007: persistence and replay
SQLite stores fictional patients and append-only daily observations. Pre-generated replay observations remain in a separate table inaccessible to inference. Replay stops at the final pre-event reading for event patients; their last-updated date stays visible. Reset explicitly restores the original cohort and discards manual local changes.

## ADR-008: demo delivery
React/TypeScript/Vite builds static assets served by FastAPI from the same origin. Localhost is the default run binding; Docker publishes only to host loopback. No hosted service is deployed by this implementation. Models use native JSON and are regenerated, rather than committing binary or pickle artifacts.
