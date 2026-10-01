# Interface direction

The redesign follows the [redesign skill in Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill/blob/main/skills/redesign-skill/SKILL.md), with the repository’s minimalist guidance informing the palette and spacing.

## Visual choices

- Warm paper, dark ink, terracotta accents, and muted semantic risk colors.
- Newsreader headings and DM Sans for controls, patient data, and explanatory text. Fonts are served locally.
- Top navigation and open sections with dividers; the patient queue receives the most space.
- A code-native ink illustration explicitly labeled as decorative anatomy. The patient preview includes a real risk-history sparkline.
- Plain, specific copy; risk categories and synthetic-data provenance remain explicit.
- Phosphor icons and a small matching ECG favicon.

## Interaction choices

Scenario and daily-reading forms open in a side drawer. Existing escape-to-close behavior, focus trapping, validation, API calls, and persistence behavior are retained. Keyboard focus, a skip link, loading placeholders, hover and pressed states, and reduced-motion support are included.

Small screens use stacked sections and an internally scrollable patient table. Secondary interface text is at least 12 CSS pixels; chart labels receive separate treatment to remain readable as SVGs scale.

## Verification

The production TypeScript/Vite build passes. Real-browser checks cover search, risk filtering, patient tabs, export, scenario non-persistence, reading ingestion, replay, model evidence, research, and drawer keyboard focus. All pages and patient tabs are checked for viewport overflow at 360, 768, 1024, and 1440 pixels. Desktop and mobile screenshots are inspected locally.

This change concerns presentation. Model training, inference, API contracts, synthetic data, and research assumptions are unchanged.
