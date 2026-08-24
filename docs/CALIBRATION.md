# Human calibration

Quality Judge remains preview-only until a blinded, preregistered calibration gate passes. Model
output, agents, synthetic reviewers, maintainer intuition, and generated judgments do not count as
genuine human review.

The product implementation will publish a rubric, corpus-selection contract, anonymization,
pairwise tool, judgment schema, training manifest, and thresholds. At least 25% of pairs remain a
private untouched holdout. Review source is fetched at immutable commits, shown process-only with
owner and popularity hidden, and never copied into judgment exports.

Activation requires at least three experienced human reviewers, 200 judgments, 75 repositories,
all activated languages, no reviewer over 50%, complete holdout and bias results, an exact report
bound to every quality version, a new scoring version, and the separate approval gate. Thresholds
cannot be lowered after holdout inspection without invalidating and restarting calibration.
