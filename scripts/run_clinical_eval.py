"""Run calibrated, clinician-relevant evaluation on frozen CardioTwin model."""
import argparse
import json
from pathlib import Path
from cardiotwin.clinical_eval import run_clinical_evaluation
from cardiotwin.config import ARTIFACTS

def main():
    parser = argparse.ArgumentParser(description="Generate clinician-relevant remote monitoring evaluation report")
    parser.add_argument("--artifacts", default=str(ARTIFACTS), help="Directory containing risk_model.json and metadata.json")
    parser.add_argument("--bootstraps", type=int, default=250, help="Patient bootstrap iterations")
    parser.add_argument("--output", default=str(ARTIFACTS / "clinical_evaluation.json"), help="Output path")
    args = parser.parse_args()

    report = run_clinical_evaluation(model_dir=args.artifacts, n_bootstraps=args.bootstraps, output_path=args.output)

    print("\n================ CLINICIAN-RELEVANT EVALUATION REPORT ================")
    ci = report["confidence_intervals_95"]
    print("\n[1] 95% Bootstrap Confidence Intervals (Patient-Level Clustering):")
    print(f"  - ROC-AUC:            {ci['roc_auc']['mean']:.3f} [{ci['roc_auc']['ci_lower']:.3f}, {ci['roc_auc']['ci_upper']:.3f}]")
    print(f"  - PR-AUC:             {ci['pr_auc']['mean']:.3f} [{ci['pr_auc']['ci_lower']:.3f}, {ci['pr_auc']['ci_upper']:.3f}]")
    print(f"  - Brier Score:        {ci['brier']['mean']:.3f} [{ci['brier']['ci_lower']:.3f}, {ci['brier']['ci_upper']:.3f}]")
    print(f"  - Daily Sensitivity:  {ci['daily_sensitivity']['mean']*100:.1f}% [{ci['daily_sensitivity']['ci_lower']*100:.1f}%, {ci['daily_sensitivity']['ci_upper']*100:.1f}%]")
    print(f"  - Daily Specificity:  {ci['daily_specificity']['mean']*100:.1f}% [{ci['daily_specificity']['ci_lower']*100:.1f}%, {ci['daily_specificity']['ci_upper']*100:.1f}%]")
    print(f"  - False Alerts/Month: {ci['false_alerts_per_month']['mean']:.2f} [{ci['false_alerts_per_month']['ci_lower']:.2f}, {ci['false_alerts_per_month']['ci_upper']:.2f}]")
    print(f"  - Event Sensitivity:  {ci['event_sensitivity']['mean']*100:.1f}% [{ci['event_sensitivity']['ci_lower']*100:.1f}%, {ci['event_sensitivity']['ci_upper']*100:.1f}%]")

    cal = report["calibration"]
    print(f"\n[2] Calibration Assessment:")
    print(f"  - Expected Calibration Error (ECE): {cal['ece']:.4f}")
    print(f"  - Maximum Calibration Error (MCE):  {cal['mce']:.4f}")

    audit = report["event_audit"]
    print(f"\n[3] Decompensation Event Audit:")
    print(f"  - Total Test Events:    {audit['total_events']}")
    print(f"  - Detected Events:      {audit['detected_events']} ({audit['event_recall']*100:.1f}%)")
    print(f"  - Missed Events:        {audit['missed_events']}")
    print(f"  - Mean Lead Warning:    {audit['mean_lead_days']:.2f} days prior to hospitalization")

    print("\n[4] Clinician Alert Budget Operating Points:")
    print(f"{'Target Max False Alerts/Mo':<28} | {'Operating Threshold':<20} | {'Event Recall':<14} | {'Observed FA/Mo'}")
    print("-" * 80)
    for b in report["alert_budget_operating_points"]:
        target = f"<= {b['target_max_budget']:.2f} / pt-month"
        pt = b["operating_point"]
        thresh = f"{pt['threshold']:.2f}"
        rec = f"{pt['event_recall']*100:.1f}%"
        obs = f"{pt['false_alerts_per_month']:.2f} / pt-mo"
        print(f"{target:<28} | {thresh:<20} | {rec:<14} | {obs}")

    print(f"\nFull structured evaluation artifact saved to: {args.output}")

if __name__ == "__main__":
    main()
