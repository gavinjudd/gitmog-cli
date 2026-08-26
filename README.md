# Git Mog

Git Mog is a deterministic CLI that compares public GitHub evidence for entertainment. Created by https://github.com/gavinjudd and https://github.com/Solvent-Duck

```sh
npx -y gitmog alice bob
```

It is not a hiring score and does not claim to measure private work, intelligence, or total
engineering ability. Every scored claim has public evidence. Target repositories are never
cloned or executed, and raw source is never persisted.

## Optional Private Context

Public-only remains the default. `--private-context` can add a separate aggregate reading from
private repositories deliberately selected during installation of the read-only Git Mog Private
Context GitHub App:

```sh
npx -y gitmog alice bob --private-context
```

After the user chooses sign-in, Git Mog opens the exact GitHub page in the default browser.
Press Enter while the code is pending to open it again, or use the displayed link if the browser
does not open. `--no-open` and `GITMOG_NO_BROWSER=1` keep the flow manual. If the Private Context
App still needs installation or selected-repository setup, Git Mog rechecks it and continues the
same command; public-only continuation remains available.

The authenticated login must match one participant. All-repository installations are refused.
The app has only metadata read and contents read permission, with no private key, client secret,
webhook, write, admin, organization, or account access. Its device token is memory-only; raw source
is process-only; no private cache exists; names and paths never enter results. Target code is never
executed. Private Context cannot change the public score or winner, and every mixed surface says
who added context and that the winner still uses public repositories only.

Use `--public-only` to suppress every private prompt and endpoint. `--anonymous` implies
public-only. See [docs/PRIVATE_CONTEXT.md](docs/PRIVATE_CONTEXT.md) for exact bounds, revocation,
organization approval, and maintained-versus-attributed behavior.

## Public development upstream

This repository is the authoritative editable source for the shipped CLI runtime beginning
with v0.3.0. The historical v0.2.2 source-export manifest and checksums remain under
`docs/releases/v0.2.2/`; that release is still reproducible from tag `v0.2.2`.

The private integration repository pins one exact public commit. Runtime changes are made and
reviewed here, then consumed through its bounded synchronization contract. npm packages and
public GitHub Releases are built from this repository.

## Contribute

Canonical development uses Node 24.19.0 and pnpm 11.21.0:

```sh
node scripts/bootstrap.mjs
pnpm run doctor
pnpm verify
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for focused tests, documentation-only changes,
AI-assisted contribution rules, false-positive reports, and language proposals. Architecture,
testing, release, security, and quality-validation contracts live under [docs/](docs/ARCHITECTURE.md).

The released package remains zero-runtime-dependency, has no install lifecycle behavior, uses
no native addon, and performs no runtime parser download.

## Code Quality · Preview

Ordinary profile and battle output includes a compact parser-backed preview after the canonical
read. Maintained-codebase quality describes sampled source from public repositories the profile
owns or materially maintains. Attributed-code quality appears separately only when bounded public
commit evidence associates sampled paths with that profile. Missing attribution is never negative
evidence.

TypeScript and JavaScript use the pinned TypeScript AST parser in a resource-limited worker.
Python, Go, and other languages are unsupported in v0.4.1 and reduce preview coverage instead of
quality. Target code is never cloned, installed, imported, built, tested, or executed; raw source
is process-only and is never stored in receipts, caches, logs, or exports.

Quality Preview has `scoreInfluence: 0`. It does not change the canonical score, score coverage,
rounds, winner, margin, verdict, battle key, or existing evidence. Its policy is
informational-only and has no enabled branch.
