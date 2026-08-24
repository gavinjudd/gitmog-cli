# Security boundaries

- Treat source, metadata, paths, parser input, and terminal text as adversarial.
- Never clone, install, import, compile, test, build, evaluate, or execute target code.
- Never persist raw source in caches, logs, errors, snapshots, fixtures, JSON, receipts, Actions
  artifacts, calibration judgments, or repository history.
- Bound requests, response bytes, decoded bytes, parser time, memory, nodes, nesting, imports,
  symbols, and tokens; a parser failure lowers quality coverage and cannot fail canonical scoring.
- Package runtime is pure Node plus reviewed embedded Wasm if needed: no native addon, install
  script, runtime download, target runtime, model provider, or external prose generation.
- Workflows use SHA-pinned actions, read-only default permissions, no `pull_request_target`, no
  self-hosted runner, and no secret on untrusted pull requests.

The in-process offline test guard is defense in depth, not an operating-system sandbox. Report
vulnerabilities through GitHub private vulnerability reporting; do not open a public exploit issue.
