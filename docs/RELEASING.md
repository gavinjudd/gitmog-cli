# Releasing

Releases are built from clean public `main`. A release candidate must bind an exact public commit,
version, package member allowlist, SHA-256, SHA-512 SRI, npm shasum, SBOM, licenses, parser assets,
runtime dependencies, install scripts, engine range, platform evidence, and quality policy.
For a Private Context release it also binds the public GitHub App name, slug, app ID, client ID,
exact metadata/contents read permissions, device-flow state, selected-repository requirement, and
zero private-key/client-secret counts.

GitHub Actions may build and retain a candidate but cannot publish from an ordinary pull request.
No npm credential is stored in repository secrets. Tags are annotated and immutable. The exact
candidate is accepted under every supported Node and architecture lane before publication.
The release workflow uses standard GitHub-hosted runners only; no self-hosted or paid larger
runner is part of the release contract.

`scripts/build-release-artifact.mjs` packs once, runs the complete offline platform acceptance
against that exact tarball, and emits `release-metadata.json`, `SHA256SUMS.txt`, `SBOM.json`,
`LICENSES.json`, and `platform-acceptance.json` beside it. The metadata binds package members,
engine and install behavior, parser assets, Quality Judge versions when present, and the
fail-closed informational-only policy. A failed exact-tarball acceptance prevents artifact upload.

Quality Preview remains separate from the battle score. Its release notes must state that score
influence is zero and winner selection is unchanged. `v0.2.2` and its archived source-export
evidence remain available. Publication requires the release-specific approval and any unavoidable
user-only 2FA.

Before publication, require synthetic privacy/invariance gates, one selected-repository live
acceptance in disposable home/cache state, byte-identical public baseline hashes, unchanged cache
fingerprints, six-architecture acceptance, Node 22/24/26 acceptance, and two byte-identical builds.
No private identifier, live capture, token, device code, or source may enter a release asset. The
GitHub App installation remains selected-repository only; v0.4.1 publication requires the exact
release-specific approval phrase in its release packet.
