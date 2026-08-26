# Security boundaries

- Treat source, metadata, paths, parser input, and terminal text as adversarial.
- Never clone, install, import, compile, test, build, evaluate, or execute target code.
- Never persist raw source in caches, logs, errors, snapshots, fixtures, JSON, receipts, Actions
  artifacts, calibration judgments, or repository history.
- Bound requests, response bytes, decoded bytes, parser time, memory, nodes, nesting, imports,
  symbols, and tokens; a parser failure lowers quality coverage and cannot fail canonical scoring.
- Run parser-backed product analysis in a dedicated worker with hard per-file and profile timers,
  V8 heap/stack resource limits, cancellation, discarded stdout/stderr, and source-free errors.
- Package runtime is pure Node plus reviewed embedded Wasm if needed: no native addon, install
  script, runtime download, target runtime, model provider, or external prose generation. The sole
  subprocess exception is the spawn-only, closed-destination browser opener documented in
  [SECURITY.md](../SECURITY.md); no target-derived value can enter its command or arguments.
- Workflows use SHA-pinned actions, read-only default permissions, no `pull_request_target`, no
  self-hosted runner, and no secret on untrusted pull requests.
- Keep public-capacity OAuth and Private Context GitHub App tokens in distinct call graphs. The
  private token is one-use, memory-only, scope-empty, and may reach only bounded private endpoints.
- Refuse all-repository GitHub App installations and any app configuration containing unknown,
  write, admin, organization, webhook, private-key, or client-secret material.
- Private repository names, owners, paths, URLs, IDs, SHAs, commit messages, source, email, and
  installation IDs remain process-only. Mixed outputs may contain aggregate counts and `P`
  receipts only; no private persistent cache exists.

The in-process offline test guard is defense in depth, not an operating-system sandbox. Report
vulnerabilities through GitHub private vulnerability reporting; do not open a public exploit issue.
