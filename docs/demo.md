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
   - Show the **Calibrated Risk Score** with **95% Confidence Interval** (e.g., `74% [67% – 81%]`) and explain that uncertainty widens when telemetry coverage drops.

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
   - Show the frozen benchmark: **0.965 ROC-AUC [0.952–0.977]**, **0.834 PR-AUC [0.793–0.870]**, Brier score **0.029**, and ECE **0.0133**.
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

## Concrete Use-Case Narrative: The 5-Day Early Warning of Patient HF-0011

Judges remember concrete patient stories. Rather than showing abstract population aggregates, anchor your 3-minute jury walkthrough on **Patient HF-0011**:

```
[Day 1–14: Frozen Baseline] ──> [Day 35: Replay Start (32% Risk)] ──> [Days 37–38: Subclinical Shift (48%)]
                                                                               │
[Day 41: Acute Hospital Event] <── [Day 39–40: Digital Twin Flags Alert (74%)] <┘
         ▲                                     ▲
         └──────── 5.0 Days Lead Time ─────────┘
```

### Patient Character Profile
- **Identifier**: `HF-0011` (Starred demo patient in the priority queue)
- **Clinical EHR Context**: 53-year-old female, HFrEF with LVEF 54.1%, NYHA Functional Class IV, baseline eGFR 68 mL/min, serum creatinine 1.1 mg/dL, baseline hemoglobin 12.8 g/dL.
- **Vulnerability**: Extreme baseline vulnerability due to NYHA Class IV status, meaning even minor physiological shifts pose severe decompensation risks.

### Chronological Trajectory
| Phase | Days | Physiology & Telemetry | Digital Twin State | Clinician Interpretation |
|---|---|---|---|---|
| **1. Baseline Window** | Days 1–14 | Resting HR 77 bpm, weight 64.9 kg, respiration 17/min, steps 2,400/day | Frozen median + MAD calculated | Establishes patient-specific normal range; prevents population threshold false alarms. |
| **2. Replay Starting Point** | Day 35 | Resting HR 88 bpm, weight 66.1 kg, respiration 19.7/min, steps 1,617 | Risk: **32%** (Watch) | Patient is stable with mild compensated variation. |
| **3. Subclinical Shift** | Days 37–38 | Weight +1.4 kg (66.8 kg), respiratory rate 20.5/min, HRV drops to 19.4 ms | Risk: **48%** (Elevating) | Fluid retention and sympathetic activation emerge before overt physical distress. |
| **4. Acute Alert State** | Days 39–40 | Step count collapses to **100 steps/day** (severe fatigue), resting HR reaches **96 bpm** (+19 bpm over personal baseline), SpO₂ 96% | Risk: **74% [67%–81% CI]** (High Risk 🔴) | Digital twin flags High Risk alert. TreeSHAP shows weight baseline deviation (+0.48 log-odds) and respiratory rate (+0.36 log-odds) driving risk. |
| **5. Adverse Event** | Day 41 | Acute heart failure decompensation / hospital admission | Ground-Truth Event | **5.0 days advance warning** delivered prior to hospitalization. |

### Pitch Delivery Script (What to Say on Stage)
> *"Judges, let's look at Patient HF-0011. She is a 53-year-old female with NYHA Class IV heart failure. On Day 35, her digital twin showed 32% risk — she felt fine at home.*
> 
> *Watch what happens as we advance the replay. On Day 38, her weight creeps up 1.4 kg, respiration edges up, and her HRV collapses. She hasn't called her clinic yet because she doesn't feel short of breath.*
> 
> *By Day 40, her steps drop to 100 a day and her pulse hits 96 bpm — 19 bpm above her personal baseline. The twin's calibrated risk spikes to 74% and fires an alert into the triage queue.*
> 
> *In our simulation ground truth, she is hospitalized on Day 41. That means CardioTwin gave the clinical team a **5.0-day head start** to adjust oral diuretics and prevent an emergency department admission."*

---

## Technical Rehearsal Checklist

- [x] Backend running on port 8000 (`python -m scripts.run_demo`)
- [x] Frontend compiled into `dist/` with zero TypeScript errors (`npm run build`)
- [x] Full test suite green (52 passed tests: benchmark, stress, fusion, clinical eval, ingestion, api)
- [x] Reset demo endpoint functional (`POST /api/demo/reset`)
- [x] Frozen benchmark verified with 0 diffs (`python -m scripts.freeze_benchmark --verify`)
- [x] All 4 evaluation endpoints active: `/api/evaluation`, `/api/evaluation/stress`, `/api/evaluation/fusion`, `/api/evaluation/clinical`
