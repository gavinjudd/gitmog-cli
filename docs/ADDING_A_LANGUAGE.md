# Adding a language

A language lane begins as unsupported. A proposal must name a real AST/CST parser, exact version,
license, supply-chain history, package form, and caller. It must prove pure JavaScript or embedded
Wasm portability with no native addon, postinstall compilation, external compiler, target runtime,
or runtime download.

Required fixtures cover valid, malformed, adversarially deep, huge-token, Unicode-path, and
unsupported syntax. The parser must meet byte, time, memory, node-count, depth, import, symbol,
token, cancellation, deterministic traversal, error-redaction, package, and all-platform gates.
License and checksums belong in the SBOM.

Shipping parser code does not activate quality scoring. The language also needs calibration corpus
coverage and must meet its preregistered human holdout threshold before any later score activation.
