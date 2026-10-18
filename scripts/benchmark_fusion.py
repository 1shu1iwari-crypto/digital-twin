"""Benchmark EHR fusion approaches against wearable-only on identical patients."""
import argparse
import json
from pathlib import Path
from cardiotwin.config import ARTIFACTS
from cardiotwin.fusion import run_paired_fusion_benchmark

def main():
    parser = argparse.ArgumentParser(description="Evaluate incremental prognostic value of EHR fusion")
    parser.add_argument("--patients", type=int, default=None, help="Total patient cohort size")
    parser.add_argument("--seed", type=int, default=None, help="Cohort random seed")
    parser.add_argument("--bootstraps", type=int, default=500, help="Patient-level bootstrap iterations")
    parser.add_argument("--output", default=str(ARTIFACTS / "fusion_benchmark.json"), help="Output path")
    args = parser.parse_args()

    report = run_paired_fusion_benchmark(n=args.patients, seed=args.seed, n_bootstraps=args.bootstraps)

    out_p = Path(args.output)
    out_p.parent.mkdir(parents=True, exist_ok=True)
    out_p.write_text(json.dumps(report, indent=2))

    print("\n========================= EHR FUSION PAIRED BENCHMARK =========================")
    print(f"Test cohort: {report['n_test_patients']} patients, {report['n_test_observations']} daily observations (Identical across all models)\n")
    print(f"{'Model Architecture':<32} | {'ROC-AUC':<7} | {'PR-AUC':<7} | {'Brier':<7} | {'Delta-AUC (95% CI)':<22} | {'Delta-PRAUC (95% CI)':<22}")
    print("-" * 105)

    for item in report["models"]:
        name = item["name"]
        m = item["metrics"]
        auc = f"{m['roc_auc']:.3f}"
        pr = f"{m['pr_auc']:.3f}"
        brier = f"{m['brier']:.3f}"

        delta = item["paired_delta_vs_wearable"]
        if delta is None:
            delta_auc_str = "Reference" if "Wearable" in name else "N/A"
            delta_pr_str = "Reference" if "Wearable" in name else "N/A"
        else:
            d_auc = delta["delta_auc"]
            d_pr = delta["delta_pr_auc"]
            delta_auc_str = f"{d_auc['mean']:+.3f} [{d_auc['low']:+.3f}, {d_auc['high']:+.3f}]"
            delta_pr_str = f"{d_pr['mean']:+.3f} [{d_pr['low']:+.3f}, {d_pr['high']:+.3f}]"

        print(f"{name:<32} | {auc:<7} | {pr:<7} | {brier:<7} | {delta_auc_str:<22} | {delta_pr_str:<22}")

    print(f"\nSaved benchmark results to: {out_p}")

if __name__ == "__main__":
    main()
