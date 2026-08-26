# Known limitations

- Git Mog scores public GitHub evidence only; missing public evidence lowers canonical coverage.
- Optional Private Context observes only deliberately selected repositories and cannot measure all
  private work or produce a comparable private opponent score.
- v0.4.0 Quality Preview supports parser-backed TypeScript and JavaScript. Python, Go, and every
  other language reduce quality coverage and receive no quality claim.
- Quality Preview is a separate product signal and does not affect the canonical score or winner.
- One-time GitHub device authorization is session-only and requests no scope.
- Hosted architecture lanes verify browser command construction, not that a desktop browser was
  visibly opened. Browser failure remains nonfatal and uses the manual GitHub link.
- Private Context uses a different session-only GitHub App token, refuses all-repository
  installations, and can be unavailable while the public battle succeeds.
- Organization repositories without maintain/admin permission can be attribution-only; missing
  attribution is neutral.
- Cache entries contain stable public metadata and derived features, never raw source.
- Private Context has no persistent cache and its aggregate claims are not independently checkable
  by viewers.
- Architecture support is claimed only after an exact package passes the named hosted lane.
