# CardioTwin-HF

Read docs/DECISIONS.md before changing architecture.
This is a synthetic-data research demonstration, never clinically validated.
Do not introduce diagnosis, treatment, medication, or causal intervention advice.
Split models by patient; fit imputers and baselines without future information.
Never expose event dates, synthetic scenario tags, or identifiers as model inputs.
Keep simulation assumptions in config/simulation.yaml, separate from clinical evidence.
Verify changes to inference, temporal features, persistence, and API contracts with tests.
Use native JSON XGBoost artifacts, never load untrusted pickle files.

## Task progress (update after finishing each task; details and handoff in work.md)

- [x] 1. Freeze a reproducible benchmark — `cardiotwin/benchmark.py`, `scripts/freeze_benchmark.py`
  (`--verify` retrains from the frozen seed and diffs), manifest at `benchmarks/current/manifest.json`
  (version, seed, config hash, split IDs, metrics, dataset/model hashes, environment). Tests: `tests/test_benchmark.py`.
- [x] 2. Independent stress-test evaluation — `cardiotwin/stress.py`, `config/stress.yaml`,
  `scripts/run_stress_tests.py` (evaluates frozen model across 10 out-of-distribution scenarios without retraining),
  report saved at `artifacts/stress_evaluation.json`. Tests: `tests/test_stress.py`.
- [x] 3. Improve EHR fusion and benchmark it — `cardiotwin/fusion.py`, `scripts/benchmark_fusion.py`
  (benchmarks 5 architectures on 120 identical test patients with paired bootstrap 95% CIs: Contextual Interaction
  Fusion demonstrates +0.015 [0.006, 0.023] Delta-AUC and +0.096 [0.054, 0.142] Delta-PR-AUC over wearable-only).
  Report saved at `artifacts/fusion_benchmark.json`. Tests: `tests/test_fusion.py`.
- [x] 4. Add calibrated, clinician-relevant evaluation — `cardiotwin/clinical_eval.py`,
  `scripts/run_clinical_eval.py` (patient-level bootstrap 95% CIs: ROC-AUC 0.965 [0.952, 0.977], PR-AUC 0.834 [0.793, 0.870];
  ECE=0.0133; alert budget operating curve <=0.20 to 1.00 FA/pt-mo; per-event lead time audit 5.56 days on 50 test events).
  Report saved at `artifacts/clinical_evaluation.json`. Tests: `tests/test_clinical_eval.py`.
