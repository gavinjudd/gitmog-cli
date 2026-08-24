# Quality Judge engineering validation

Quality Judge is a visible product signal that remains separate from the battle score. The
machine-readable policy is [quality/QUALITY_SCORE_POLICY.json](../quality/QUALITY_SCORE_POLICY.json):
it has one informational-only state, fixes score influence at zero, and has no enabled branch.
Missing or malformed policy input fails closed to the same non-scoring state.

The required engineering suite validates the supported behavior directly:

- formatting-only changes, identifier renaming, cache state, repository ordering, and opponent
  ordering do not change the quality reading;
- meaningful failure-path tests improve only applicable test evidence, while empty tests do not;
- supported import cycles reduce only applicable architecture evidence and removing the cycle
  restores the prior reading;
- supported dynamic evaluation and unsafe shell construction reduce only applicable security
  evidence and removing either defect restores the prior reading;
- unsupported languages and parser failures reduce coverage instead of manufacturing a score or
  making the canonical battle unavailable;
- raw source never enters results, result identity, cache entries, receipts, JSON, logs, or
  artifacts;
- planned source and attribution opportunity is deterministic, while current HTTP calls and cache
  hits are invocation-local telemetry;
- cold, warm, refresh, and no-cache runs preserve quality findings and result identity for
  identical evidence and caps;
- Quality Judge never changes the canonical score, winner, verdict, battle key, evidence, or
  battle bytes.

The contract is enforced by package tests, request-planner tests, CLI/package acceptance,
scripts/quality-fixtures.mjs, scripts/quality-policy-check.mjs, the quality benchmark, and the
canonical-invariance tests. Run:

```sh
pnpm quality:fixtures
pnpm quality:policy:check
pnpm quality:benchmark:check
pnpm benchmark:check
pnpm verify
```

Contributors can use the false-positive and false-negative issue forms to submit reduced synthetic
fixtures. A report may cite a public repository and immutable commit for context, but must not copy
raw target source into an issue, fixture, log, or artifact.

Any future use of code quality in canonical scoring requires a separately versioned scoring
release with an explicit reviewed formula change. The informational preview does not imply that
such a release will occur.
