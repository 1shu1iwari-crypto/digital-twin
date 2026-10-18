export type Review = { patient_id: string; day: number; state: string; note: string; updated_at: string | null }
export type Patient = {
  patient_id: string
  name: string
  age: number
  sex: string
  hf_type: string
  lvef: number
  nyha: number
  creatinine: number
  egfr: number
  sodium: number
  hemoglobin: number
  previous_admissions: number
  diabetes: number
  ckd: number
  copd: number
  risk: number | null
  status: string
  coverage: number
  last_day: number
  timestamp: string
  review_state?: string
  review_note?: string
  review_updated_at?: string | null
}
export type Contribution = { feature: string; label: string; contribution: number; value: number | null }
export type Risk = {
  probability: number
  threshold: number
  ci_lower?: number
  ci_upper?: number
  uncertainty_width?: number
  explanation: { method: string; units: string; base_value: number; log_odds: number; contributions: Contribution[] }
}
export type Signal = {
  key: string
  label: string
  value: number | null
  unit: string
  baseline: number | null
  deviation: number | null
  delta: number | null
}
export type Twin = {
  patient_id: string
  risk: Risk | null
  status: string
  timestamp: string
  last_day: number
  signals: Signal[]
  indices: { name: string; value: number | null; direction: string }[]
  quality: { coverage: number; baseline_ready: boolean; today_coverage: number }
}
export type Observation = {
  day: number
  timestamp: string
  risk: number | null
  risk_lower?: number | null
  risk_upper?: number | null
  [key: string]: string | number | null | undefined
}
export type Evaluation = {
  n_patients: number
  n_samples: number
  n_observations: number
  positive_fraction: number
  split_counts: Record<string, number>
  models: {
    name: string
    roc_auc: number
    pr_auc: number
    brier: number
    sensitivity: number
    specificity: number
    threshold: number
    event_sensitivity: number
    mean_lead_days: number | null
    false_alerts_per_patient_month: number
    calibration: { predicted: number; observed: number }[]
  }[]
}
export type TelemetryBatchSummary = {
  patient_id: string
  inserted: number
  updated: number
  deduplicated: number
  backfilled: number
  affected_days: number[]
}
