"""Freeze or verify the reproducible benchmark manifest (benchmarks/current/manifest.json)."""
import argparse
import json
import sys
from cardiotwin.benchmark import BENCHMARK_DIR, freeze, verify
from cardiotwin.config import ARTIFACTS

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="retrain from the manifest seed and compare")
    parser.add_argument("--artifacts", default=str(ARTIFACTS), help="directory written by scripts.train_model")
    parser.add_argument("--output", default=str(BENCHMARK_DIR))
    parser.add_argument("--tolerance", type=float, default=1e-6)
    args = parser.parse_args()
    if args.verify:
        result = verify(f"{args.output}/manifest.json", args.tolerance)
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["ok"] else 1)
    manifest = freeze(args.artifacts, args.output)
    print(f"Frozen {len(manifest['metrics'])} model results, seed {manifest['seed']}, "
          f"{manifest['data']['n_patients']} patients -> {args.output}/manifest.json")

if __name__ == "__main__":
    main()
