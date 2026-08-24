# Governance

Git Mog uses maintainer-led governance with public technical decisions. Maintainers own release
integrity, security response, deterministic scoring, calibration gates, and community safety.
Routine changes are accepted through reviewed pull requests after required checks pass.

Changes to scoring, winner selection, parser activation, calibration thresholds, package trust,
or security boundaries require a public ADR and maintainer approval. Quality-score activation
also requires the complete preregistered human-calibration artifact and the separately defined
approval gate; passing tests alone is insufficient.

Maintainers may use an emergency administrator path for a confirmed security incident or broken
repository control. The exception must be narrowly scoped and documented afterward. Force pushes,
history rewrites, and moving released tags are not accepted maintenance tools.
