# Quality Judge human calibration

This directory preregisters the blinded human calibration gate for Quality Judge. It contains no
human judgments and no copied public source. Quality Preview remains outside canonical Git Mog
scoring while [`QUALITY_SCORE_ACTIVATION.json`](QUALITY_SCORE_ACTIVATION.json) is disabled.

## What exists now

- [`RUBRIC.md`](RUBRIC.md) defines the exact pairwise question and review dimensions.
- [`PREREGISTRATION.md`](PREREGISTRATION.md) fixes the corpus, blinding, holdout, analysis, and
  activation rules before judgments are collected.
- [`schema/`](schema) contains machine-readable batch, judgment, and report contracts.
- [`public-training-manifest.json`](public-training-manifest.json) truthfully records that corpus
  selection has not started.
- [`tools/review-pairwise.mjs`](tools/review-pairwise.mjs) is the local, no-upload reviewer CLI.
- [`synthetic/`](synthetic) contains only authored fixtures for testing the tooling.
- `reports/` is intentionally empty until a completed calibration report is independently reviewed.

## Reviewer workflow

Qualified reviewers will receive a coordinator-produced batch file that satisfies
`schema/batch.schema.json`. The private holdout assignment is made before tuning and is never
included in the public training manifest.

```bash
node calibration/tools/review-pairwise.mjs \
  --batch /path/to/assigned-batch.json \
  --reviewer-key-file /path/to/private-reviewer-key.txt \
  --output /path/to/judgments.json
```

The tool fetches bounded files from exact public commits, keeps source in memory only, presents
anonymous sides A and B, and writes only opaque identifiers, choices, confidence, and tool
versions. It never uploads results. The reviewer key is hashed locally and is never written or
placed in shell history.

Do not use an agent, model grader, synthetic reviewer, or maintainer intuition as a reviewer. Do
not paste source into issues or judgments. A reviewer who recognizes a project must choose
`insufficient` for that pair and record the preregistered reason `identity-recognized`.
