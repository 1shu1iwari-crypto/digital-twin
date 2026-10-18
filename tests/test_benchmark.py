import copy
import json
from cardiotwin.benchmark import build_manifest, compare, freeze, verify

def test_manifest_is_deterministic_and_complete(model_dir):
    first, second = build_manifest(model_dir), build_manifest(model_dir)
    assert first == second
    assert first["synthetic"] and not first["clinical_validation"]
    assert first["seed"] == 2026
    assert first["model"]["artifact_sha256"] and first["data"]["dataset_sha256"]
    assert len(first["metrics"]) == 6
    for key in ["python", "platform", "packages"]:
        assert key in first["environment"]
    assert first["environment"]["packages"]["xgboost"]

def test_manifest_splits_match_artifact_and_stay_disjoint(model_dir):
    manifest = build_manifest(model_dir)
    assert manifest["splits"] == json.loads((model_dir / "splits.json").read_text())
    sets = [set(ids) for ids in manifest["splits"].values()]
    assert not (sets[0] & sets[1] or sets[0] & sets[2] or sets[1] & sets[2])
    assert {k: len(v) for k, v in manifest["splits"].items()} == manifest["split_counts"]

def test_manifest_features_exclude_identifiers_and_labels(model_dir):
    features = set(build_manifest(model_dir)["model"]["features"])
    assert not {"patient_id", "day", "target", "event_day", "scenario"} & features

def test_freeze_writes_manifest(model_dir, tmp_path):
    manifest = freeze(model_dir, tmp_path / "frozen")
    assert json.loads((tmp_path / "frozen" / "manifest.json").read_text())["seed"] == manifest["seed"]

def test_compare_accepts_identical_and_flags_changes(model_dir):
    manifest = build_manifest(model_dir)
    assert compare(manifest, copy.deepcopy(manifest)) == []
    changed = copy.deepcopy(manifest)
    changed["metrics"][0]["roc_auc"] += 0.01
    changed["splits"]["test"] = changed["splits"]["test"][1:]
    problems = compare(manifest, changed)
    assert any("roc_auc" in p for p in problems) and "split patient IDs differ" in problems

def test_verify_retrains_to_same_frozen_results(model_dir, tmp_path):
    freeze(model_dir, tmp_path)
    result = verify(tmp_path / "manifest.json")
    assert result["ok"], result["problems"]
    assert result["environment_drift"] == {}
