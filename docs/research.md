# Research basis and implementation boundary

These primary studies motivate the architecture. No paper's reported performance is used as this application's performance, and no published cohort is included in the generated dataset.

| Study | Design principle used here | Boundary |
| --- | --- | --- |
| [Stehlik et al., LINK-HF, 2020](https://pubmed.ncbi.nlm.nih.gov/32093506/) — DOI 10.1161/CIRCHEARTFAILURE.119.006513 | Personal physiological baseline and multivariate wearable deviations | This implementation is an independent synthetic simulator; it does not reproduce the proprietary LINK-HF algorithm |
| [Artificial intelligence based real-time prediction of imminent heart failure hospitalisation in patients undergoing non-invasive telemedicine, 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11449733/) | Short-horizon prediction from EHR and daily remote monitoring | Independent XGBoost feature pipeline; no TIM-HF2 data or study model is imported |
| [Gu et al., Identification of digital twins to guide interpretable AI for diagnosis and prognosis in heart failure, 2025](https://www.nature.com/articles/s41746-025-01501-9) | Patient-specific virtual state and interpretable prognostic features | Their mechanistic cardiovascular modeling is substantially richer; this prototype only maintains a data-driven state |

The chosen 14-day stable window, noise distributions, amplitude ranges, missingness, 0–100 indices, abstention rules and UI risk categories are engineering assumptions documented in configuration and the model card. They are not claimed to be validated medical parameters. A real deployment needs measured data, appropriate consent/access, verified enrollment stability, external outcome evaluation and prospective clinical validation.
