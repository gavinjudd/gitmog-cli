# ADR 0003: Optional selected-repository Private Context

- Status: accepted for v0.4.0
- Date: 2026-08-25

## Decision

Keep every canonical Git Mog profile and battle public-only. Add Private Context as a one-way CLI
dependency that consumes a completed public result and can attach only a separate aggregate object
with `scoreInfluence: 0`, `publicWinnerInfluence: 0`, and `persisted: false`.

Use a separate public GitHub App with device flow, repository metadata read, contents read, no
other permission, no webhook, no private key, and no client secret. Require the authenticated login
to match exactly one participant and require the app installation to use selected repositories.
Refuse all-repository installations.

Private REST collection reuses the existing parser isolation and hard bounds. Raw private source
and every stable repository identifier remain process-only. Output contracts permit source-free
aggregate counts and separate `P` receipts only. Public scoring, presentation selection, source
analysis, Quality Preview, cache identity, and battle identity have no dependency path back from
Private Context.

## Consequences

One participant can add context without creating a comparable private score for the opponent.
Every mixed surface must disclose the subject and state that the public winner uses public
evidence. A two-party private battle is intentionally out of scope because it would require both
participants to authorize independently source-free evidence.

Private Context cannot be reconstructed or independently verified by a viewer. The privacy gain is
deliberate: repository names, paths, URLs, IDs, SHAs, commit messages, source, and tokens do not
leave the process boundary.
