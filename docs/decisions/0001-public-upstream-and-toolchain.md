# 0001 — Public upstream and pinned contributor toolchain

**Status:** Accepted
**Date:** 2026-08-24

## Context

The v0.2.2 public repository was a one-commit sanitized export. Contributors could inspect source
but could not run the real test, build, package, or release contracts, while a private editable
copy remained authoritative.

## Decision

`gavinjudd/gitmog-cli` is the editable source of truth for the shipped CLI beginning with v0.3.0.
It contains runtime packages, runtime tests, build tooling, package acceptance, public decisions,
and release workflows. Private integration consumes one exact public commit through a literal
allowlist and never exports private paths during ordinary development.

Node 24.19.0 and pnpm 11.21.0 are authoritative version homes. All development dependencies are
exact catalog pins with present callers. Bootstrap installs workspace-local pnpm through Node and
npm, ignores lifecycle scripts, and requires the frozen lockfile in CI. The shipped package retains
zero runtime dependencies and zero install lifecycle behavior.

The direct development and build dependency license review is recorded in
`config/toolchain-licenses.json`. Every pinned tool is MIT-licensed except TypeScript, which is
Apache-2.0. Both licenses are compatible with this MIT-licensed development and distribution model;
none of these tools is a runtime dependency of the published package. A dependency change must
update the exact pin, lockfile, license review, and this decision in the same pull request.

## Consequences

External contributors can reproduce the real merge and package gates without private files. Public
main now has normal review history after the immutable v0.2.2 export root. Private applications and
operations remain private, but runtime changes cannot be edited independently there.
