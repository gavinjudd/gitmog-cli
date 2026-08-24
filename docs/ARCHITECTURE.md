# Architecture

Git Mog is a CLI-first TypeScript workspace. Dependency flow is one way:

```text
github -> analyzers
personality -> github + analyzers
source-analysis -> github + analyzers + personality + scoring
battle -> github + personality + scoring + source-analysis
cli -> battle and presentation dependencies
distribution -> bundled CLI
```

`packages/scoring` owns the canonical numeric score, rounds, winner, verdict, evidence, and
battle key. Additive products may consume a completed immutable battle but scoring cannot import
them. The package is bundled into `dist/gitmog.mjs`; workspace imports and development tools may
not survive into the tarball.

Public source is authoritative for every runtime package, runtime test, bundle tool, package
acceptance harness, public ADR, and release workflow. A private integration consumer pins one
exact public commit and imports only a literal allowlist. Private apps, operations, and
integration-only tests do not flow back into this repository.

Target repository data is untrusted. Collection uses bounded public API requests and immutable
blob identity. Source is decoded only in process, reduced to safe derived features, and
discarded. No target clone, dependency, compiler, runtime, test, build, import, or execution is
permitted.
