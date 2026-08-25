# Quality Judge feedback

Quality Judge is a visible informational preview separate from the battle score. Submit a
[false-positive report](https://github.com/gavinjudd/gitmog-cli/issues/new?template=quality-false-positive.yml)
when a supported TypeScript or JavaScript metric fires incorrectly. Submit a
[false-negative report](https://github.com/gavinjudd/gitmog-cli/issues/new?template=quality-false-negative.yml)
when a supported applicable pattern is missed. Missing language, syntax, sample, attribution, or
parser coverage belongs in the language-support form instead.

Every metric report must contain a reduced synthetic fixture that can run offline. Use invented
identifiers and the smallest source shape that reproduces the behavior. A public repository,
immutable commit, safe path, receipt ID, or limitation ID may be supplied as context, but do not
copy target source into the issue or fixture. Never submit credentials, private source, personal
information, generated dependencies, or an executable target project.

Use the [Code Quality feedback Discussion category](https://github.com/gavinjudd/gitmog-cli/discussions/categories/code-quality-feedback)
for false positives, false negatives, supported-language gaps, and Code Quality Preview behavior.

Accepted fixtures join the engineering-validation suite. They can refine the separate preview but
cannot change the canonical score, winner, verdict, battle identity, or `scoreInfluence: 0` policy.
