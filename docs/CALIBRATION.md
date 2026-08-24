# Human calibration

Quality Judge remains preview-only until the blinded, preregistered calibration gate passes. The
complete contract lives in [`calibration/`](../calibration/README.md):

- [`RUBRIC.md`](../calibration/RUBRIC.md) fixes the human review question and dimensions.
- [`PREREGISTRATION.md`](../calibration/PREREGISTRATION.md) fixes corpus selection, anonymization,
  holdout assignment, exact statistics, thresholds, and invalidation rules.
- [`schema/`](../calibration/schema) defines batches, source-free judgment exports, the public
  training manifest, and the eventual activation report.
- [`tools/review-pairwise.mjs`](../calibration/tools/review-pairwise.mjs) fetches exact public
  commits at review time, presents anonymous sides, persists no source, and never uploads.

At least 25% of pairs remain a private untouched holdout. Activation requires at least three
experienced human reviewers, 200 judgments, 75 repositories, every activated language, no
reviewer over 50%, completed bias and error review, and an independently reviewed report bound to
every quality version. Thresholds cannot be lowered after holdout inspection without invalidating
and restarting calibration.

Current truthful state: zero human judgments, human calibration pending, and score activation
structurally disabled. Model output, agents, synthetic reviewers, maintainer intuition, and
generated judgments do not count.
