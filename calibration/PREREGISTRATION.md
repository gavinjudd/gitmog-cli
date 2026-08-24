# Quality Judge activation preregistration

Status: preregistered before human judgment collection. Human judgments collected: **0**.

Changing an outcome rule after holdout results are inspected invalidates the gate and requires a
new calibration version, fresh holdout assignment, and recollection.

## Corpus contract

The target corpus is 75–150 public repositories at exact immutable commit SHAs. Every activated
parser language must be represented. Selection is stratified across libraries, applications,
CLIs, services, systems code, monorepos, small and large repositories, intentionally clean and
messy examples, generated-code-heavy controls, framework-heavy controls, and both popular and
unpopular projects. Popularity is used only to audit leakage and is unavailable to the Quality
Judge and reviewers.

Repositories must have an OSI-compatible license permitting review, an immutable public commit,
and enough non-generated source for the bounded sampling contract. The exclusion reason is
recorded before outcomes are known. Project fame, owner identity, and Git Mog score are never
features.

The public training manifest contains only training assignments and safe aggregate descriptors.
At least 25% of distinct comparison pairs are assigned to a private holdout by a deterministic
SHA-256 partition keyed by a coordinator-held preregistration salt before tuning. The salt,
holdout membership, and holdout judgments remain private until the gate closes. No repository may
appear on both sides of the training/holdout boundary through a duplicate fork or renamed mirror.

## Review and blinding contract

At least three genuine humans with material software-engineering experience produce at least 200
pairwise judgments covering at least 75 distinct repositories and every activated language. No
reviewer may control more than 50% of accepted judgments. Side order is determined from
SHA-256(calibration version, batch, reviewer pseudonym, pair) and is stable for resumability.

The reviewer tool hides repository, owner, stars, forks, followers, Git Mog output, and Quality
Preview. It fetches only allowlisted paths from exact public commits, caps each decoded file at 20
KiB and each side at 150 KiB, keeps source process-only, and never uploads. Judgment exports
contain no source, URL, owner, repository, email, reviewer identity, or popularity measure.

Model output, agents, synthetic reviewers, maintainer intuition, and generated decisions do not
count. Reviewers who recognize a project mark the pair insufficient.

## Fixed analysis plan

- Inter-rater reliability: Krippendorff's alpha for nominal outcomes, ties retained and
  insufficient judgments excluded pairwise. Required alpha: **>= 0.60**.
- Holdout pairwise agreement: Quality Judge preference agrees with the majority human preference
  on **>= 0.70** of decisive pairs, and the two-sided exact Clopper–Pearson 95% confidence
  interval is reported.
- Activated-language agreement: each cohort agrees on **>= 0.62** of decisive pairs, with exact
  binomial confidence intervals reported separately.
- Rank agreement: Spearman rank correlation between preview ordering and the Bradley–Terry
  aggregate human ordering is **>= 0.55**; a two-sided exact permutation p-value is reported.
- Repository-size inversion: no stratum has an odds ratio below 1 with a two-sided Fisher exact
  p-value below 0.05 after Holm correction.
- Language inversion: the same exact stratified test and Holm correction; no activated language
  may be systematically inverted.
- Popularity leakage: a permutation test on residual preference versus preregistered popularity
  strata must not reject independence at 0.05 after Holm correction. Popularity is audit-only.
- Calibrated confidence: lower-coverage outputs must abstain or fail to insufficient more often;
  their error rate may not be presented as equally certain. Coverage calibration is reported by
  fixed quartile bins.
- False-positive and false-negative review: every supported finding family has an independently
  reviewed error table, including applicability and coverage failures.

`tie` contributes to reliability but not decisive agreement. `insufficient` is excluded from
preference statistics and reported as a separate failure/abstention rate. Missing cohorts fail the
gate; unavailable evidence never receives a zero.

## Activation decision

Activation additionally requires a schema-valid report bound to the exact corpus digest, holdout
digest, judgment digest, Quality Judge result version, parser contract, source selection,
attribution method, dimension formula, calibration schema, presentation, and cache version. An
independent reviewer must approve the report, a later release must define a new canonical scoring
version and migration, and the exact phrase `APPROVE QUALITY JUDGE SCORE ACTIVATION` must be
received after all artifacts are complete.

The phrase cannot waive a failed or incomplete artifact. v0.3.0 contains no enabled code path.
