# Git Mog

Git Mog is a deterministic CLI that compares public GitHub evidence for entertainment.

```sh
npx -y gitmog alice bob
```

It is not a hiring score and does not claim to measure private work, intelligence, or total
engineering ability. Every scored claim has public evidence. Target repositories are never
cloned or executed, and raw source is never persisted.

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
testing, release, security, and calibration contracts live under [docs/](docs/ARCHITECTURE.md).

The released package remains zero-runtime-dependency, has no install lifecycle behavior, uses
no native addon, and performs no runtime parser download.
