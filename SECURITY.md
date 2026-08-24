# Security

Git Mog treats every target repository as untrusted input.

The default public analysis may read bounded repository trees and immutable public blobs.
It never clones a target, follows a target symlink, installs dependencies, imports source,
evaluates expressions, or runs target scripts, tests, builds, formatters, or binaries.
The analyzer is lexical and must not claim parser or AST precision.

Raw source has a deliberately short lifetime:

1. reject tree entries whose trustworthy size exceeds 12,000 decoded bytes before the
   bounded request-candidate pool is selected;
2. fetch one selected immutable blob through a bounded response reader; missing or
   dishonest size metadata remains subject to the streamed ceiling;
3. validate GitHub's decoded size, base64 length, and actual decoded bytes;
4. reject an oversized or malformed envelope before retaining or decoding it;
5. cancel a streamed response as soon as its raw-response ceiling is crossed;
6. redact secret-shaped values in memory;
7. extract deterministic feature counts and coverage;
8. discard the source string before returning from the blob reader.

The source-blob response envelope is capped at 20,630 raw bytes: 16,000 base64
characters for exactly 12,000 decoded bytes, up to 534 JSON newline-escape bytes, and
4,096 bytes of bounded GitHub JSON metadata. An explicit larger `Content-Length` is
rejected before body consumption; missing or false length metadata cannot bypass the
streaming cap. Oversized bodies never enter the derived cache or evidence receipts.
Rate-limit status and headers are inspected before this body reader: 429, exhausted 403,
and accepted retry/reset metadata return structured rate-limit state immediately and cancel
the body where supported. A multi-megabyte, invalid, or unreadable error body therefore
cannot mask a known rate limit or make sampling continue.

Redaction is a heuristic, not a secrecy guarantee. Public source is still public evidence;
the safety property is that raw bytes and excerpts do not leave this process path and are
never written to cache. Logs, results, JSON, receipts, and packed artifacts contain only
identifiers, URLs, SHAs, metadata, feature vectors, coverage, and redaction counts.

The derived cache key includes repository identity, tree/commit SHA, blob SHA, normalized
path, language/analyzer lane, byte limit, analyzer version, source-feature version, and
redaction version. It stores immutable validated feature data only; current path, source
URL, language, test classification, selection score, and sample ID are rebuilt into a
fresh receipt for every selection. A source receipt ID separately hashes a
domain-separated stable object containing the repository identity, immutable revision,
blob SHA, and the exact original Git path encoded as UTF-8 bytes. Display normalization
therefore cannot collapse distinct NFC/NFD paths. Duplicate paths sharing one blob use a
bounded per-command network-read cache without sharing path identity. That memo is
consulted before the HTTP allowance, so a validated immutable blob remains reusable after
the first path consumes the final request slot.

Persisted Code DNA and derived-feature entries use separate exact, fail-closed schema
allowlists. Required and nested keys, types, bounds, enums, array members, versions,
checksums, and plain-object prototypes are validated. Unknown or case-variant fields,
prototype-shaped objects, unsafe keys, malformed values, and invalid checksums reject the
whole entry. The generic sensitive-key scan remains defense in depth. Corrupt or unsafe
entries are deleted and treated as misses.

Profile snapshots are a separate trust boundary. Files use the exact
`2.0.0-default-full-profile-snapshot` schema and `default-full-snapshot:2` cache identity in
a checksummed, timestamped envelope. The parser accepts plain objects with exact keys only,
validates bounded nested arrays and strings, repository identity, immutable tree and blob
SHAs, known enums, the snapshot digest, expiry, and envelope checksum, and rejects old,
partial, case-variant, prototype-shaped, or unknown-field objects. An invalid entry is a
miss; it is neither trusted nor removed or replaced until a successful collection can be
written atomically.

Whole-profile source analysis also carries structured failure provenance and an explicit
`stable` or `transient` cache disposition. Only READY results and PARTIAL results whose
entire failure set is on the deterministic allowlist may persist. Rate limits, timeouts,
transport/upstream failures, unavailable trees or blobs, incomplete responses, and unknown
failures are transient and never overwrite a valid stable entry. `--refresh` bypasses both
snapshot and whole-profile source-analysis reads, plus derived-feature reads, while allowing
a new stable replacement;
`--no-cache` performs neither persistent reads nor writes.

Whole-profile Code DNA cache identity is versioned separately and includes the immutable
snapshot key, Code DNA and axis versions, sampling and feature/redaction versions, and the
resolved logical source-request allowance. It excludes tokens, headers, current HTTP-call
counts, cache telemetry, timestamps, and unrelated usernames. A stable bounded PARTIAL can
therefore be reused only inside the exact source opportunity scope that produced it.

GitHub access uses native HTTPS. An explicit `GITHUB_TOKEN` or `GH_TOKEN` can raise public
rate limits; different simultaneous values are rejected as ambiguous. Tokens are never
printed, cached, serialized, placed in cache identity, or passed in process arguments.
When an interactive anonymous request plan cannot support the complete analysis, Git Mog
may offer a one-time GitHub device authorization. The public client asks for no OAuth scope,
uses no client secret, and keeps the resulting token in process memory only for that
invocation. It neither requests nor receives private-repository, organization, write,
admin, gist, or workflow permission.

Tokenless analysis remains bounded to 16 requests per profile and 32 per battle. A typed,
cache-aware request plan checks the current allowance before expensive collection and makes
no profile or source requests when no honest result fits. Request counters reflect actual
HTTP calls accepted by the budget, not candidate attempts. A primary limit is not retried
before reset; secondary limits respect bounded retry-after handling. Valid earlier evidence
may yield a structured partial result, but an insufficient run never fabricates a score or
identity.

CLI grammar, raw share values, aliases, mutually exclusive output modes, receipt-mode
compatibility, and case-insensitive same-handle battles are validated before cache creation
or collection. Invalid presentation requests are local usage errors and cannot spend a
GitHub call or write a snapshot.

Human terminal, card, receipt, and share renderers treat GitHub names, repository names,
paths, and URLs as untrusted display text. C0/C1 controls are deterministically rendered
as visible escapes on one line before width or character-limit calculations. Fight-card
cells are sanitized, truncated, padded, and centered as plain text before ANSI is applied;
every styled cell resets before its separator or border. Newlines, carriage returns,
CSI/OSC sequences, bells, backspaces, and terminal hyperlinks therefore cannot execute or
bleed styling. JSON retains the original data contract and relies on JSON escaping; no
ANSI is inserted into JSON and stable evidence IDs are not rewritten.

Report vulnerabilities through this repository's GitHub private vulnerability reporting.
For other sensitive contact, use the public private-contact channel on
[@gavinjudd's profile](https://github.com/gavinjudd). Do not include credentials, private
source, cookies, or raw target blobs in a public issue.
