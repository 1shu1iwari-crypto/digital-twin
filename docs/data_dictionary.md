# Data and simulation assumptions

**Provenance:** 100% in-house simulated data. No real patients, device uploads, Synthea, PhysioNet or hospital records. Seed 2026 generates the training benchmark; seed 7026 generates 32 independent UI demo patients. IDs are local labels and are never model features.

## Static EHR fields

Age (years), sex (display only), LVEF (%), derived HF phenotype (display only), NYHA class, creatinine (mg/dL), eGFR (mL/min/1.73m²), sodium (mmol/L), hemoglobin (g/dL), previous admission count, diabetes, CKD and COPD. Boolean comorbidities are 0/1.

## Daily observations

| Field | Unit | Input source represented |
| --- | --- | --- |
| resting_hr | bpm | Wearable daily resting pulse |
| hrv | ms | Simplified HRV summary; no specific device or estimator |
| respiratory_rate | breaths/min | Wearable-style daily respiratory summary |
| spo2 | % | Daily oxygen saturation |
| steps | steps/day | Daily activity |
| weight | kg | Connected scale |
| systolic_bp / diastolic_bp | mmHg | Home blood-pressure cuff |
| sleep_hours | hours | Daily sleep duration |

Every signal has current reading, 3-/7-day mean and slope, 7-day standard deviation, 7-day missing fraction, and MAD-normalized personal deviation. `timestamp` and integer `day` order observations; they are never predictive inputs.

## Generator assumptions

`config/simulation.yaml` is the source of truth. It defines 800 patients, 60 days, 14-day baseline, seven-day horizon, event prevalence, independent sensor gaps, artifacts, baseline ranges, scale floors, noise and perturbation ranges. These are engineering choices, not fitted clinical distributions or published medical cutoffs.

Stable trajectories include patient-specific baseline and autocorrelated noise. Deteriorating trajectories have variable onset, amplitude, affected sensors and signal offsets. Negative events include transient weight/pulse/respiration/activity excursions; COPD can produce a lower stable oxygenation baseline. The simulator generates daily summaries without circadian sub-day traces.

## Outcomes

`event_day` represents one fictional HF hospitalization. Observations stop before that event. Label is 1 exactly when `day < event_day <= day+7`. A negative training row is included only when at least seven more days of observed outcome follow-up are known. Patients without events have follow-up through day 60, so days 54–60 are censored from negative training samples. Outcomes/scenario tags never enter prediction inputs or patient APIs.

Baseline MAD is `median(abs(x-median(x)))`; it is not multiplied by 1.4826. A configured floor prevents division by tiny values. Large deviations remain data features, not automatic medical alerts. Missing readings stay NaN for XGBoost; missingness is also explicitly modeled.
