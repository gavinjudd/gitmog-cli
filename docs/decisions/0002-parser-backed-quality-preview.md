# ADR 0002: Parser-backed Quality Preview lanes

- Status: accepted for v0.3.0 preview
- Date: 2026-08-24

## Decision

Activate TypeScript and JavaScript quality lanes with the exact TypeScript 6.0.3 compiler parser.
Keep Python and Go unsupported until separate real-parser, fixture, package, portability, security,
license, and calibration-cohort gates pass.

The parser is shipped as the single allowlisted
`dist/parsers/quality-worker.mjs` asset. Product analysis uses a worker thread with a 500 ms
per-file hard timeout, a 2-second per-profile hard timeout, V8 heap and stack resource limits,
cancellation, and safe structured failures. The main CLI never dynamically downloads a grammar or
invokes an external compiler or target runtime.

## Bake-off

The machine-readable record is [`config/parser-bakeoff.json`](../../config/parser-bakeoff.json).

| Candidate                     | AST/CST                          | Portability and packaging                                                                               | Outcome            |
| ----------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------ |
| TypeScript compiler 6.0.3     | Real recoverable TS/JS AST       | Pinned Apache-2.0 JavaScript; reproducibly bundled; worker isolated                                     | Selected for TS/JS |
| Babel parser                  | Real JS/TS AST                   | Pure JavaScript, but duplicates the selected lanes and adds a callerless dependency                     | Not selected       |
| Web Tree-sitter plus grammars | Real CST when correctly packaged | Could cover all four lanes, but the exact grammar/checksum/security/six-architecture gate is incomplete | Deferred           |

The selected parser passed synthetic valid, malformed, oversized, deep, token, Unicode, privacy,
timeout, cancellation, bundle, and local package gates. Final platform support remains contingent
on the exact packed v0.3.0 artifact passing every required hosted lane.

## Consequences

Unsupported Python and Go source lowers coverage and produces no quality score or negative
finding. Lexical Code DNA may still describe style, but it cannot claim implementation quality.
The parser asset increases package size for real parsing capability; its exact checksum is recorded
in release evidence and the SBOM.
