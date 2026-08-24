# Releasing

Releases are built from clean public `main`. A release candidate must bind an exact public commit,
version, package member allowlist, SHA-256, SHA-512 SRI, npm shasum, SBOM, licenses, parser assets,
runtime dependencies, install scripts, engine range, platform evidence, and activation state.

GitHub Actions may build and retain a candidate but cannot publish from an ordinary pull request.
No npm credential is stored in repository secrets. Tags are annotated and immutable. The exact
candidate is accepted under every supported Node and architecture lane before publication.

Quality Preview is not scoring activation. Its release notes must state that calibration is
pending and winner selection is unchanged. `v0.2.2` and its archived source-export evidence remain
available. Publication requires the release-specific approval and any unavoidable user-only 2FA;
quality-score activation has a separate later gate.
