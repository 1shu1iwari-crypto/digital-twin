# Measured benchmark and verification

The default run uses seed 2026 and **800 fictional patients**, producing **43,294 daily observations**. Entire patients are assigned to 560 training / 120 validation / 120 test. Labels and full provenance are described in the model card. This is a synthetic software benchmark, not clinical validation.

| Model | ROC-AUC | PR-AUC | Brier ↓ | Daily sensitivity | Specificity | False episodes / patient-month | Mean lead days |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| EHR logistic | 0.492 | 0.083 | 0.075 | 82.0% | 19.2% | 0.68 | 7.00 |
| EHR only | 0.462 | 0.073 | 0.075 | 44.0% | 52.8% | 0.39 | 7.00 |
| Wearable only | 0.949 | 0.737 | 0.037 | 66.6% | 97.6% | 0.40 | 5.18 |
| EHR + wearable | 0.947 | 0.739 | 0.037 | 67.1% | 97.5% | 0.40 | 5.27 |
| No temporal features | 0.959 | 0.824 | 0.031 | 72.3% | 98.0% | 0.39 | 5.38 |
| Personalized CardioTwin | 0.963 | 0.831 | 0.029 | 77.7% | 97.6% | 0.44 | 5.66 |

The full model uses 83 features. Its validation-selected F1 threshold is 0.37, distinct from demo dashboard categories. It alerts within the seven-day label window for 50/50 synthetic test events. This event sensitivity does not imply 100% daily sensitivity. Mean lead time excludes undetected events and is bounded by the seven-day target window; static persistent alerts can achieve a seven-day mean while providing poor discrimination.

Personalized features improve this simulator's benchmark. EHR-only models are near chance because static clinical relationships are only weakly represented. Temporal features add relatively little beyond personal current deviations here. These findings do not establish which features are most useful clinically. The full model's false-episode rate is also slightly higher than some simpler models at their separately selected operating thresholds.

## Verification record

- Python regression/integration suite: **21 passed**. Covers deterministic/bounded simulation, causal features, batch/live equivalence, censoring, disjoint patients, calibrated TreeSHAP additivity, API contracts, replay isolation, scenario non-mutation, input validation, abstention, missing individual index values and SQLite restart persistence.
- TypeScript strict checks and Vite production build: **passed**.
- Real Chromium smoke: **passed** on 1440px desktop and 390px mobile. Search/filter, focused-patient navigation, export, all patient tabs, scenarios, telemetry save, daily replay/play/pause, evaluation and research navigation. **Zero JavaScript exceptions**, no viewport-wide horizontal overflow.
- Rendered desktop and mobile screenshots were visually inspected during development.
- Docker CLI was unavailable in the development environment. Dockerfile/Compose are included but the container build was **not executed**.

One dependency deprecation warning comes from Starlette's HTTPX-based test client; it does not affect passing assertions. The code does not suppress it. Generated metrics live in `artifacts/evaluation.json`, and the dashboard reads that file rather than this rounded table.

Tested runtime: Python 3.12.14, NumPy 2.3.5, pandas 2.2.3, scikit-learn 1.8.0, XGBoost 3.4.1, FastAPI 0.142.2, Uvicorn 0.54.0, Pydantic 2.13.5, Node 24.19.0 and Vite 6.4.3. The frontend dependency graph is committed in package-lock.json. Python compatibility ranges are declared in pyproject.toml; small numerical differences may occur with future dependency versions.
