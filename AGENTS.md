# Git Mog public-upstream instructions

This repository is the authoritative editable source for every package and file needed to
build and publish the Git Mog CLI. Contributions belong here. The private integration
repository consumes an exact public commit and must not be used as a second editable copy.

Before editing, read `README.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, and the nearest
package contract. Preserve deterministic output, the untrusted-source boundary, and the
zero-runtime-dependency package. Target repositories are never cloned, installed, imported,
built, tested, evaluated, or executed. Raw target source is process-only and never belongs in
logs, caches, fixtures, snapshots, artifacts, issues, or commits.

The CLI is the shipped product. Do not add a web application or private integration surface.
Scoring and winner selection cannot depend on Quality Judge. Tests are offline and synthetic
by default. Add no dependency without a present caller, exact pin, license review, and an ADR.

Run `node scripts/bootstrap.mjs`, then `pnpm verify`. Do not commit, push, merge, tag, publish,
or change repository settings unless the current task explicitly authorizes it.
