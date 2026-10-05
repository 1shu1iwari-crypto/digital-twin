# CardioTwin-HF

**A living patient model. An earlier signal of change.**

A complete local hackathon prototype for personalized, seven-day heart-failure decompensation monitoring. Fictional EHR context meets daily wearable and home-device readings in an evolving patient twin.

> All data is synthetic. Model performance measures this simulator, not clinical accuracy. This application provides no diagnosis, treatment advice, or causal intervention estimates.

## What works

- **Clinician dashboard:** risk-sorted population queue, search and filtering, patient details, personal baselines, sensor trends, twin indices, EHR profile, daily ledger and JSON export.
- **Living demo:** play/pause or advance daily wearable replay; readings, risk, indices and explanations update together.
- **Personalization:** 14-day frozen median/MAD baselines, 3-/7-day trends, variability and sensor missingness. Inference abstains when baseline or current coverage is inadequate.
- **Trained model:** XGBoost with validation-only sigmoid calibration; native TreeSHAP explains calibrated log-odds.
- **Scientific benchmark:** patient-disjoint 70/15/15 split; logistic, EHR-only, wearable-only, combined, no-temporal and full-personalized comparisons; AUC, PR-AUC, Brier, calibration, sensitivity, specificity, event recall, false alerts and lead time.
- **Scenario explorer:** change one day's weight, pulse, respiration and activity without modifying stored readings.
- **Backend:** FastAPI, validated telemetry ingestion, fictional patient creation and SQLite persistence.
- **Wearable gateway:** Apple HealthKit, Android Health Connect/Samsung bridge, Google Health, Garmin and Oura source contracts normalize into the existing daily telemetry model.
- **Delivery:** tests, CI, Docker configuration, methods, model card and demo script.

## Run locally

Install **Python 3.11+** and **Node.js 22+**. In a terminal:

```bash
git clone https://github.com/1shu1iwari-crypto/digital-twin.git
cd digital-twin
git checkout feat/cardiotwin-prototype
python -m venv .venv
```

Activate the environment on Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

Or macOS/Linux:

```bash
source .venv/bin/activate
```

Then:

```bash
python -m pip install -e ".[dev]"
cd frontend
npm ci
npm run build
cd ..
python -m scripts.run_demo
```

The first run generates 800 fictional patients and trains six benchmark models. Allow a few minutes; progress is printed. Subsequent launches reuse native JSON artifacts and your SQLite ledger.

Open **http://127.0.0.1:8000**. Interactive API documentation is at **http://127.0.0.1:8000/docs**.

After merging the implementation PR, the checkout command above is optional: the code will be on `main`.

### Docker alternative

```bash
docker compose up --build
```

Open the same URL after training completes. Two named volumes preserve the model and demo database. Docker configuration is provided; see the verification record for whether Docker was available during development.

### Development

```bash
python -m scripts.train_model
python -m uvicorn cardiotwin.api:app --reload
```

In another terminal:

```bash
cd frontend
npm run dev
```

Vite serves http://localhost:5173 and proxies `/api` to the backend. Run Python commands from the repository root, or after installing this project in editable mode.

## Tests and reproducibility

```bash
python -m pytest -q
cd frontend
npm run build
```

Tests independently train a small 80-patient model and verify causality, train/live feature equivalence, label censoring, disjoint patients, SHAP additivity, API validation, non-mutating scenarios, replay isolation, abstention and persistence.

Optional real-browser smoke checks (after building the frontend and training):

```bash
cd frontend
npx playwright install chromium
cd ..
python -m scripts.verify_browser
```

The browser check starts an isolated demo server/database, exercises the UI, and writes temporary desktop/mobile screenshots to `test-results/`. It requires port 8011 to be free. An existing Chromium executable may be selected with `CARDIOTWIN_BROWSER_EXECUTABLE`.

```bash
python -m scripts.generate_data --patients 800
python -m scripts.train_model --patients 800 --seed 2026
```

Inputs are exported to `data/synthetic`; outcome metadata stays in a separate CSV and is never a model feature. Generated model and data files are ignored by Git and recreated locally. Changing configuration requires retraining.

## Documentation

| File | Purpose |
| --- | --- |
| [Architecture](docs/architecture.md) | Modules, persistence and API contracts |
| [Decisions](docs/DECISIONS.md) | Stable design choices for future changes |
| [Data dictionary](docs/data_dictionary.md) | Signals, units, labels and provenance |
| [Model card](docs/model_card.md) | Intended use, calibration, metrics and limits |
| [Research](docs/research.md) | Primary papers motivating the design |
| [Evaluation](docs/evaluation.md) | Measured benchmark and verification record |
| [Demo guide](docs/demo.md) | Two-minute walkthrough and next milestones |
| [Wearables](docs/wearables.md) | HealthKit, Health Connect, Google Health and production data-stack architecture |

This is a local research demo without authentication or access controls. The replay/reset endpoints are intended for fictional data in a single workspace. Wearable source contracts and normalization are now scaffolded, but native device authorization, actual clinical data, production FHIR exchange, security controls, externally validated forecasting and mechanistic physiology remain future work.


## Production-shaped data stack

The local demo remains intentionally small and reproducible. For a real wearable deployment, install the optional production dependencies with:

```bash
python -m pip install -e ".[production]"
```

The intended path is PostgreSQL + TimescaleDB for normalized time-series data, S3/Cloud Storage + Parquet for raw/history files, Redis for cache/jobs, and FHIR adapters for clinical interoperability. These are architectural extension points; the current demo continues to use SQLite unless you implement and configure those services.
