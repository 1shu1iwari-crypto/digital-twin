"""Frozen, reproducible benchmark manifest: version, seed, split IDs, metrics and environment.

The manifest only records and re-checks results from the synthetic simulator. It is not
clinical validation, and it never feeds anything back into model training.
"""
import hashlib
import importlib.metadata as metadata
import json
import platform
import subprocess
import sys
import tempfile
from pathlib import Path
from .config import ARTIFACTS, ROOT, load_config

SCHEMA_VERSION = 1
BENCHMARK_DIR = ROOT / "benchmarks" / "current"
PACKAGES = ["numpy", "pandas", "scikit-learn", "xgboost", "scipy", "fastapi", "pydantic", "PyYAML"]
IGNORED_METRIC_KEYS = {"name", "calibration"}

def _sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def environment():
    versions = {}
    for package in PACKAGES:
        try:
            versions[package] = metadata.version(package)
        except metadata.PackageNotFoundError:
            versions[package] = None
    return dict(python=sys.version.split()[0], implementation=platform.python_implementation(),
                platform=platform.platform(), machine=platform.machine(), packages=versions)

def git_state(root=ROOT):
    def run(*args):
        try:
            result = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, timeout=15)
        except (OSError, subprocess.SubprocessError):
            return None
        return result.stdout.strip() if result.returncode == 0 else None
    commit = run("rev-parse", "HEAD")
    return dict(commit=commit, dirty=bool(run("status", "--porcelain")) if commit else None)

def build_manifest(directory=ARTIFACTS):
    """Assemble a manifest from artifacts written by cardiotwin.model.train()."""
    directory = Path(directory)
    report = json.loads((directory / "evaluation.json").read_text())
    splits = json.loads((directory / "splits.json").read_text())
    meta = json.loads((directory / "metadata.json").read_text())
    try:
        package_version = metadata.version("cardiotwin-hf")
    except metadata.PackageNotFoundError:
        package_version = None
    config = {**load_config(), "seed": meta["seed"]}
    return dict(
        schema_version=SCHEMA_VERSION,
        synthetic=True, clinical_validation=False,
        model=dict(name="Personalized CardioTwin", package_version=package_version,
                   artifact_sha256=_sha256(directory / "risk_model.json"),
                   features=meta["features"], calibration=meta["calibration"],
                   threshold=meta["threshold"], xgb_params=report["xgb_params"]),
        seed=meta["seed"], config_sha256=meta["config_sha256"], config=config,
        data=dict(n_patients=report["n_patients"], n_observations=report["n_observations"],
                  n_samples=report["n_samples"], positive_fraction=report["positive_fraction"],
                  dataset_sha256=report["dataset_sha256"]),
        splits=splits, split_counts=report["split_counts"],
        metrics=report["models"],
        environment=environment(), git=git_state())

def freeze(directory=ARTIFACTS, output=BENCHMARK_DIR):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    manifest = build_manifest(directory)
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest

def compare(expected, observed, tolerance=1e-6):
    """Return human-readable differences. Splits and seeds must match exactly; metrics within tolerance."""
    problems = []
    if expected["seed"] != observed["seed"]:
        problems.append(f"seed {expected['seed']} != {observed['seed']}")
    if expected["splits"] != observed["splits"]:
        problems.append("split patient IDs differ")
    if expected["config_sha256"] != observed["config_sha256"]:
        problems.append("simulation config hash differs")
    if expected["data"]["dataset_sha256"] != observed["data"]["dataset_sha256"]:
        problems.append("dataset fingerprint differs")
    if expected["model"]["features"] != observed["model"]["features"]:
        problems.append("feature list differs")
    old = {row["name"]: row for row in expected["metrics"]}
    new = {row["name"]: row for row in observed["metrics"]}
    if set(old) != set(new):
        problems.append(f"model variants differ: {sorted(set(old) ^ set(new))}")
    for name in sorted(set(old) & set(new)):
        for key in sorted(set(old[name]) - IGNORED_METRIC_KEYS):
            a, b = old[name][key], new[name].get(key)
            if a is None or b is None:
                if a != b:
                    problems.append(f"{name}.{key}: {a} != {b}")
            elif abs(a - b) > tolerance:
                problems.append(f"{name}.{key}: {a:.6f} vs {b:.6f}")
    return problems

def verify(manifest_path=BENCHMARK_DIR / "manifest.json", tolerance=1e-6):
    """Retrain from the frozen seed/cohort size in a scratch directory and compare to the manifest."""
    from .model import train
    expected = json.loads(Path(manifest_path).read_text())
    with tempfile.TemporaryDirectory() as scratch:
        train(output=scratch, n=expected["data"]["n_patients"], seed=expected["seed"])
        observed = build_manifest(scratch)
    problems = compare(expected, observed, tolerance)
    drift = {key: (expected["environment"]["packages"].get(key), version)
             for key, version in observed["environment"]["packages"].items()
             if expected["environment"]["packages"].get(key) != version}
    if expected["environment"]["python"] != observed["environment"]["python"]:
        drift["python"] = (expected["environment"]["python"], observed["environment"]["python"])
    return dict(ok=not problems, problems=problems, environment_drift=drift)
