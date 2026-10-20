# CardioTwin Architecture Generalization: Continuous Glucose & Multi-Morbidity Twin

> **Architecture Note**: This specification documents how the CardioTwin dual-stream late-fusion architecture generalizes from 7-day heart-failure decompensation monitoring to 2-hour continuous glucose spike and hypoglycemia forecasting, as outlined in the Happiest Health Digital Twin Hackathon requirements.

---

## 1. Executive Summary & Problem Mapping

The hackathon challenge mandates a digital twin capable of fusing two foundational health data streams:
1. **Static / Historical Data**: Electronic Health Records (demographics, diagnoses, lab results, genetic markers).
2. **Dynamic / Real-Time Data**: Consumer wearables & IoT sensors (HRV, continuous glucose monitors, sleep stages, step counts).
3. **Algorithmic Output**: Prediction of adverse clinical events (e.g., predicting a sudden glucose spike 2 hours in advance, or flagging a high-risk cardiovascular anomaly).

The CardioTwin architecture is **modality-agnostic**. The identical computational pipeline that predicts 7-day heart-failure decompensation directly ports to acute glycemic excursions:

```
┌───────────────────────────────────────────────────────────────┐
│                    STREAM 1: STATIC EHR                      │
│   HbA1c, Fasting Glucose, eGFR, Insulin Regimen, TCF7L2/HLA   │
└──────────────────────────────┬────────────────────────────────┘
                               │
                               ▼
┌───────────────────────────────────────────────────────────────┐
│                   CONTEXTUAL FUSION ENGINE                    │
│   Modulates dynamic velocities by static metabolic reserve    │
└──────────────────────────────▲────────────────────────────────┘
                               │
┌──────────────────────────────┴────────────────────────────────┐
│              STREAM 2: DYNAMIC WEARABLES / IOT                │
│    5-min CGM Interstitial Glucose, Steps/METs, Sleep Stages   │
│                 + 14-Day Fasting Baseline                     │
└───────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌───────────────────────────────────────────────────────────────┐
│              OUTPUT: 2-HOUR ADVERSE EVENT RISK                │
│    Calibrated Probabilities [95% CI] + TreeSHAP Attribution   │
│    • Acute Hyperglycemic Spike (>250 mg/dL)                   │
│    • Nocturnal Hypoglycemia (<70 mg/dL)                       │
└───────────────────────────────────────────────────────────────┘
```

---

## 2. Stream-by-Stream Comparison

| Architectural Component | CardioTwin-HF (Cardiovascular Twin) | GlucoTwin-CGM (Metabolic Twin) |
|---|---|---|
| **Prediction Horizon** | 7 days (sub-acute decompensation) | 2 hours (acute glycemic excursion) |
| **Stream 1: Demographics** | Age, sex | Age, sex, body mass index (BMI) |
| **Stream 1: Clinical Diagnoses** | NYHA Class, LVEF, CKD, COPD | Diabetes type (T1D/T2D), duration, retinopathy, neuropathy |
| **Stream 1: Laboratory Chemistry** | Serum sodium, creatinine, eGFR, hemoglobin | HbA1c, fasting plasma glucose, estimated GFR, lipid panel |
| **Stream 1: Genetic Markers** | Family history of cardiomyopathy, TTN variants | TCF7L2 risk alleles, HLA-DQ/DR haplotypes (T1D) |
| **Stream 2: Primary Continuous Signal** | Resting heart rate (optical PPG) | Interstitial glucose (5-min subcutaneous CGM sensor) |
| **Stream 2: Autonomic / Stress Signal** | Heart rate variability (rMSSD) | Continuous HRV (sympathovagal balance / cortisol proxy) |
| **Stream 2: Physical Activity Signal** | Daily steps, active minutes | Accelerometer cadence, real-time METs, post-meal ambulation |
| **Stream 2: Rest & Recovery Signal** | Sleep duration & fragmentation | Sleep architecture (deep/REM sleep, nocturnal dipping) |
| **Stream 2: Contextual Inputs** | Body weight (smart scale) | Smart insulin pen bolus doses, logged carbohydrates |

---

## 3. Algorithmic Formulation for 2-Hour Glucose Spike Prediction

### A. Personal Glycemic Baseline Construction
Population normal ranges (e.g. 70–140 mg/dL) generate massive false alerts due to inter-individual differences in insulin resistance, dawn phenomenon, and dietary habits. GlucoTwin constructs an individual baseline from 14 days of stable CGM data:

$$\text{Median}_{\text{fasting}} = \text{median}(\{G_{t} : t \in \text{fasting window (04:00–07:00)}\})$$
$$\text{MAD}_{\text{fasting}} = \text{median}(|G_{t} - \text{Median}_{\text{fasting}}|)$$

### B. Dynamic Feature Engineering
From the continuous 5-minute CGM stream $G(t)$, the engine extracts:
1. **Instantaneous Velocity**:
   $$\frac{dG}{dt} \approx \frac{G(t) - G(t-15\,\text{min})}{15\,\text{min}}$$
2. **Acceleration**:
   $$\frac{d^2G}{dt^2} \approx \frac{\frac{dG}{dt}(t) - \frac{dG}{dt}(t-15\,\text{min})}{15\,\text{min}}$$
3. **Rolling Postprandial Area Under Curve (AUC)**:
   $$\text{AUC}_{60}(t) = \int_{t-60}^{t} \max(0, G(\tau) - \text{Median}_{\text{fasting}})\,d\tau$$
4. **Glycemic Variability Metrics**:
   - Continuous Overall Net Glycemic Action (CONGA-1h)
   - Coefficient of Variation: $\text{CV} = \frac{\sigma(G)}{\mu(G)} \times 100\%$

### C. Contextual Late-Fusion Formulation
Following ADR-010, static EHR features modulate the dynamic velocity:

$$\mathbf{x}_{\text{fusion}} = \left[ \mathbf{x}_{\text{temporal}},\, \mathbf{x}_{\text{EHR}},\, \mathbf{x}_{\text{temporal}} \odot \mathbf{W}_{\text{reserve}} \mathbf{x}_{\text{EHR}} \right]$$

Where:
- $\mathbf{x}_{\text{temporal}}$ contains $\frac{dG}{dt}$, $\text{AUC}_{60}$, active METs, and baseline deviation.
- $\mathbf{x}_{\text{EHR}}$ contains HbA1c, eGFR, diabetes type, and insulin regimen.
- $\mathbf{W}_{\text{reserve}}$ models the patient's physiological buffer: a patient with high HbA1c (impaired first-phase insulin response) and low eGFR (delayed insulin clearance) exhibits a substantially higher excursion probability for an identical 15-minute $\frac{dG}{dt}$ rate of rise than a well-controlled patient.

---

## 4. Multi-Morbidity: The Cardiorenal-Metabolic Twin

In real clinical practice, heart failure and diabetes rarely exist in isolation:
- Over 40% of heart failure patients have co-morbid Type 2 diabetes.
- Hypoglycemia triggers adrenergic surges that exacerbate myocardial ischemia and arrhythmias.
- Hyperglycemia and sodium-glucose co-transporter dynamics directly modulate intravascular volume and congestion.

A unified **Cardiorenal-Metabolic Twin** runs both models simultaneously on a shared data ingestion ledger:
- **Acute Engine (2-Hour Horizon)**: Monitors CGM + accelerometry to predict sudden glycemic spikes and nocturnal hypoglycemic dips.
- **Sub-Acute Engine (7-Day Horizon)**: Monitors daily weight, resting HR, HRV, and respiration to predict hemodynamic congestion and heart failure decompensation.
- **Cross-Talk Feature**: Rapid glycemic variability and repeated hypoglycemia events feed as a destabilization feature into the 7-day heart failure model.

---

## 5. Architectural Readiness

The CardioTwin repository already provides the structural foundation required for this generalization:
1. **Append-Only Telemetry Ledger** (`cardiotwin/store.py`): Accepts arbitrary JSON observation payloads with timestamps.
2. **Multi-Source Device Gateway** (`cardiotwin/wearables.py`): Supports Apple HealthKit and Android Health Connect protocols, both of which support standard continuous glucose records (`HKQuantityTypeIdentifierBloodGlucose`).
3. **Native TreeSHAP Explainability** (`cardiotwin/model.py`): Decomposes acute predictions into interpretable driver contributions.
4. **Clinician Triage Workflow** (`frontend/src/App.tsx`): Supports real-time alerting, status progression, and notes.
