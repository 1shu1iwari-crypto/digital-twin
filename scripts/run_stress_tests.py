"""Run independent stress-test battery on frozen CardioTwin model."""
import argparse
import json
import sys
from cardiotwin.config import ARTIFACTS
from cardiotwin.stress import run_stress_battery

def main():
    parser = argparse.ArgumentParser(description="Evaluate frozen model on out-of-distribution stress scenarios")
    parser.add_argument("--artifacts", default=str(ARTIFACTS), help="Directory containing risk_model.json & metadata.json")
    parser.add_argument("--patients", type=int, default=None, help="Patients per stress scenario")
    parser.add_argument("--output", default=str(ARTIFACTS / "stress_evaluation.json"), help="Output JSON path")
    args = parser.parse_args()

    report = run_stress_battery(
        model_dir=args.artifacts,
        n_patients=args.patients,
        output_path=args.output
    )

    print("\n=================== STRESS TEST RESULTS ===================")
    print(f"{'Scenario':<30} | {'Abstain %':<10} | {'AUC':<7} | {'PR-AUC':<7} | {'Brier':<7} | {'False Alts/mo'}")
    print("-" * 80)
    ref_auc = None
    for item in report["scenarios"]:
        name = item["scenario"]
        abstain = f"{item['abstained_fraction']*100:.1f}%"
        m = item["usable_metrics"]
        auc_str = f"{m['roc_auc']:.3f}" if m.get("roc_auc") is not None else "N/A"
        pr_str = f"{m['pr_auc']:.3f}" if m.get("pr_auc") is not None else "N/A"
        brier_str = f"{m['brier']:.3f}" if m.get("brier") is not None else "N/A"
        fa_str = f"{m['false_alerts_per_patient_month']:.2f}" if m.get("false_alerts_per_patient_month") is not None else "N/A"
        print(f"{name:<30} | {abstain:<10} | {auc_str:<7} | {pr_str:<7} | {brier_str:<7} | {fa_str}")

if __name__ == "__main__":
    main()
