# Two-minute hackathon demo

1. Launch the application and open Patient overview. Point out that the cohort is fictional and ranked by estimated seven-day risk.
2. Open the highest-risk available patient. Compare the latest six sensor values with that individual's baseline. Explain that the same population value can represent different personal deviations.
3. Click Next day a few times or Play replay. The SQLite ledger gains daily observations and the risk trajectory/twin state update. Pause replay before discussing a result.
4. Open Explainability. Show TreeSHAP factors and the additive log-odds reconstruction. Explain that contributions are not additive probability points.
5. Open Explore a scenario. Change weight by +1 kg, pulse by +8 bpm and activity by −25%. Recompute. The estimate may move according to the trained model; no direction is guaranteed and no treatment effect is implied.
6. Open Model performance. Compare personalized vs combined/no-temporal baselines and inspect calibration. Say explicitly that this measures the simulator, not clinical efficacy.
7. Show Data timeline or Add daily reading to demonstrate validated input and persistence. Export the synthetic twin JSON if useful.

## Rehearsal notes

Reset restores replay day 35 and discards manual demo changes. Start at day 35 or advance toward day 45 to find changing patients; the model is not programmed to output a fixed dramatic risk sequence. Patient event traces stop at their final pre-event reading; the population's latest-date column shows these retained readings. Replay ends at day 60.

For the default seed, HF-0011 is a useful changing patient early in replay, and HF-0004 is useful for exploring a transient negative example and the scenario controls. Values always come from inference; these examples are not scripted risk scores.

## Completed scope

EHR simulation; wearable daily trajectories; hard negatives; personal baselines; causal features; XGBoost/logistic comparisons; calibration; native TreeSHAP; evolving twin state; SQLite API; React dashboard; non-persisted scenarios; tests and CI.

## Next milestones

- Bootstrap confidence intervals and independent simulator/noise stress tests.
- Source licensed, outcome-linked wearable/EHR datasets and implement explicit data provenance.
- Add FHIR EHR/device adapters with contract validation and authentication.
- Obtain clinical review of assumptions before prospective validation.
- Add mechanistic physiological modeling only when adequate measurements justify it.
