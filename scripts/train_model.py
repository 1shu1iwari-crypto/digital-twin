import argparse
from cardiotwin.model import train

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--patients", type=int, default=None)
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()
    report = train(n=args.patients, seed=args.seed)
    for row in report["models"]:
        print(f"{row['name']}: AUC={row['roc_auc']:.3f}, PR-AUC={row['pr_auc']:.3f}, Brier={row['brier']:.3f}")
