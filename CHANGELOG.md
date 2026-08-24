# Changelog

All notable changes are documented here. Released artifacts remain tied to immutable tags.

## Unreleased

- Retire the never-run external reviewer proposal and replace it with an informational-only
  Quality Judge policy plus deterministic engineering validation.
- Make Quality Preview request telemetry current-invocation truthful and result identity
  cache-invariant.
- Repair the CLI benchmark to reconcile canonical, quality-source, quality-attribution, allowance,
  and cache lanes separately.

## 0.3.0 - Quality Judge Preview

- Establish `gavinjudd/gitmog-cli` as the authoritative contribution-ready runtime upstream.
- Add parser-backed TypeScript and JavaScript Quality Preview readings for maintained codebases
  and separately attributed code.
- Keep Quality Preview outside canonical score, coverage, rounds, winner, margin, verdict,
  battle key, evidence, and cache identity.
- Add bounded process-only parser isolation, source-free receipts, deterministic sampling, and
  cache-invariant request planning.
- Document the then-disabled external reviewer proposal, subsequently retired for v0.3.1.
- Add public governance, contributor workflows, six-architecture CI, Node 22/24/26 acceptance,
  security checks, and exact-artifact reproducibility.

## 0.2.2

- Historical runtime-source export. Exact source manifest and checksums are archived under
  `docs/releases/v0.2.2/` and remain unchanged at tag `v0.2.2`.
