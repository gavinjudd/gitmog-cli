# Architecture

Git Mog is a CLI-first TypeScript workspace. Dependency flow is one way:

```text
github -> analyzers
personality -> github + analyzers
source-analysis -> github + analyzers + personality + scoring
battle -> github + personality + scoring + source-analysis
quality-judge -> github (safe digests and immutable source identities only)
private-context -> github + quality-judge + scoring types
cli -> battle + private-context and presentation dependencies
distribution -> bundled CLI
```

`packages/scoring` owns the canonical numeric score, rounds, winner, verdict, evidence, and
battle key. Additive products may consume a completed immutable battle but scoring cannot import
them. The package is bundled into `dist/gitmog.mjs`; workspace imports and development tools may
not survive into the tarball. Quality Judge attaches only after the canonical battle has been
built. Canonical scoring, winner selection, battle-key construction, and scorecard serialization
have no dependency path into Quality Judge.

`packages/private-context` is another one-way additive boundary. It never imports into scoring,
battle, public request planning, public collection, public source analysis, or Quality Judge's
public result. The CLI completes the canonical public object first, then may attach an aggregate
Private Context object. An invariant helper compares the canonical public serialization before
and after attachment byte for byte.

The TypeScript/JavaScript parser is a separate allowlisted worker asset. The main process sends
bounded source to that worker, receives only derived features or structured failures, and
terminates it at hard time or memory boundaries. Raw source never returns in a result.

Public source is authoritative for every runtime package, runtime test, bundle tool, package
acceptance harness, public ADR, and release workflow. A private integration consumer pins one
exact public commit and imports only a literal allowlist. Private apps, operations, and
integration-only tests do not flow back into this repository.

Target repository data is untrusted. Collection uses bounded public API requests and immutable
blob identity. Source is decoded only in process, reduced to safe derived features, and
discarded. No target clone, dependency, compiler, runtime, test, build, import, or execution is
permitted.

Browser handoff is a separate, closed CLI capability. Only
`packages/cli/src/open-external.ts` may import `spawn` from `node:child_process`, and it can
construct commands only for the reviewed GitHub device, Private Context installation, and
numeric installation-settings destinations. The URL is revalidated immediately before command
construction and is always passed as a separate argument to a fixed system executable. This
capability has no dependency path from target handles, repository data, source, tokens, or device
codes. Source and packed-bundle checks fail closed if another subprocess path appears.
