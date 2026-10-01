# CardioTwin-HF

Read docs/DECISIONS.md before changing architecture.
This is a synthetic-data research demonstration, never clinically validated.
Do not introduce diagnosis, treatment, medication, or causal intervention advice.
Split models by patient; fit imputers and baselines without future information.
Never expose event dates, synthetic scenario tags, or identifiers as model inputs.
Keep simulation assumptions in config/simulation.yaml, separate from clinical evidence.
Verify changes to inference, temporal features, persistence, and API contracts with tests.
Use native JSON XGBoost artifacts, never load untrusted pickle files.
