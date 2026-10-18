# CardioTwin-HF: Jury Demonstration & Rehearsal Runbook

> **Important Boundary**: This application is a synthetic-data engineering and ML research demonstration. It has **never been clinically validated** and does **not** provide clinical diagnosis, causal treatment effects, or medication advice.

---

## 3-Minute Jury Demonstration Script

### Act 1: The Core Problem & Personal Baselines (0:00 – 0:40)
1. **Open Patient Overview (`/`)**: Show the fictional 32-patient replay cohort ranked by 7-day decompensation risk.
2. **Highlight the Core Philosophy**: Point out why a population threshold fails in heart failure:
   - A resting heart rate of 76 bpm is an acute concern for a patient whose personal baseline is 55 bpm, but ordinary for someone whose stable baseline is 75 bpm.
   - Show how the digital twin constructs personal baselines (frozen 14-day median & MAD) rather than using static population cutoffs.
3. **Select High-Risk Patient (e.g. HF-0011)**:
   - Point out personal deviations (e.g. weight gain, resting pulse increase, HRV depletion).
   - Show the **Calibrated Risk Score** with **95% Confidence Interval** (e.g., `72% [65% – 79%]`) and explain that uncertainty widens when telemetry coverage drops.

### Act 2: Trajectory, Uncertainty & Explainability (0:40 – 1:20)
1. **Inspect Risk Trajectory Chart**:
   - Point out the **shaded ribbon**: visualizes the 95% uncertainty interval over time.
   - Click sensor tabs (Heart rate, Respiration, Weight, Activity) to see signal trajectories against the dashed individual baseline.
2. **Open Explainability Tab**:
   - Walk through the **Native TreeSHAP** waterfall: base log-odds → feature contributions (+/-) → sigmoid → calibrated probability.
   - Emphasize to the jury: *Contributions are additive in log-odds space, not percentage points. These indicate predictive associations, not causal mechanisms.*
3. **Explore a Scenario (Perturbation Sandbox)**:
   - Open *Explore a scenario*, adjust weight (+1.5 kg) and resting heart rate (+8 bpm).
   - Recompute to show immediate sensitivity without persisting modifications to patient records.

### Act 3: Clinical Triage & Persistence (1:20 – 1:50)
1. **Clinician Review & Triage**:
   - In the patient overview, demonstrate the **Clinician Review & Triage** panel.
   - Transition patient status to `Needs follow-up` or `Flagged` and type a triage rationale: *"Weight trend +1.8kg over 4 days; scheduled telephone check"*.
   - Click **Save review note** — persisted directly to SQLite ledger.
2. **Cohort Priority Queue Filter**:
   - Navigate back to Patient Overview: show the updated review badge (`NEEDS FOLLOW-UP`) in the priority table.
   - Demonstrate filtering the cohort by review state (`Needs follow-up`, `Reviewed`, `Monitoring`).

### Act 4: Multi-Sample Wearable Ingestion & Mobile Companion (1:50 – 2:20)
1. **Wearable Ingestion Contracts**:
   - Explain the ingestion engine (`cardiotwin/ingestion.py`):
     - Multi-sample intra-day aggregation (lowest sustained sample for resting HR, sum for step count/sleep, mean for SpO₂ and respiration).
     - Idempotent deduplication (re-syncing identical wearable samples does not alter database).
     - Backfill support (filling previously delayed offline syncs without corrupting temporal sequences).
2. **Mobile Companion Glance (`GET /api/patients/{pid}/companion`)**:
   - Show that patient-facing mobile apps receive a lightweight, structured daily summary with sync quality and baseline status without causal recommendations.

### Act 5: Evidence & Known Limitations (2:20 – 3:00)
1. **Model Evidence Tab**:
   - Show the frozen benchmark: **0.963 ROC-AUC**, **0.831 PR-AUC**, Brier score **0.029**, and ECE **0.0133**.
   - Show the Alert Fatigue Operating Curve: clinician can tune threshold according to alert budget (0.20 to 1.00 false alerts per patient-month).
2. **EHR-Wearable Fusion Gains (`artifacts/fusion_benchmark.json`)**:
   - Address the common trap: Naive concatenation of static EHR tabular data with wearable data actually degrades PR-AUC (-0.016).
   - Point to the **Contextual Interaction Architecture**: modulating wearable deviations by organ reserve (CKD, COPD, LVEF, NYHA) yields a statistically significant **+0.015 [0.006, 0.023] Delta-AUC** and **+0.096 [0.054, 0.142] Delta-PR-AUC** over wearable-only on 120 identical held-out test patients (200 cluster bootstraps).
3. **Stress Testing & Known Limitations (`artifacts/stress_evaluation.json`)**:
   - Show performance across 10 out-of-distribution stress scenarios:
     - Model gracefully abstains on bursty sensor dropout (high missingness).
     - False alert burden under physiological noise and drift is quantified.
   - Conclude with intellectual honesty: *This prototype proves the software architecture and algorithmic principles on synthetic trajectories. Prospective clinical trial validation is required before any hospital deployment.*

---

## Technical Rehearsal Checklist

- [x] Backend running on port 8000 (`python -m scripts.run_demo`)
- [x] Frontend compiled into `dist/` with zero TypeScript errors (`npm run build`)
- [x] Full test suite green (45 passed tests: benchmark, stress, fusion, clinical eval, ingestion, api)
- [x] Reset demo endpoint functional (`POST /api/demo/reset`)
- [x] Frozen benchmark verified with 0 diffs (`python -m scripts.freeze_benchmark --verify`)
- [x] All 4 evaluation endpoints active: `/api/evaluation`, `/api/evaluation/stress`, `/api/evaluation/fusion`, `/api/evaluation/clinical`
