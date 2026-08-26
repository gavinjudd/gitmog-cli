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

Automatic browser opening is one narrow exception to the package's subprocess prohibition.
Exactly `packages/cli/src/open-external.ts` may import `spawn` from `node:child_process`; no
other shipped source module may import that built-in. The module accepts only a validated closed
destination: `https://github.com/login/device`, the exact Git Mog Private Context installation
path, or a numeric GitHub installation-settings path returned by the reviewed App flow. It rejects
alternate origins, ports, credentials, fragments, unexpected queries, lookalike hosts, arbitrary
URLs, handles, repository data, device codes, and tokens before command construction.

The command map is fixed to `/usr/bin/open <url>` on macOS,
`C:\Windows\System32\rundll32.exe url.dll,FileProtocolHandler <url>` on Windows, and
`/usr/bin/xdg-open <url>` on Linux when both that executable and a graphical session are present.
The validated URL is always a separate argument. Processes use no shell, inherited stdio, target
working directory, or credential-bearing environment. `exec`, `execSync`, `fork`, `spawnSync`,
PowerShell strings, `cmd.exe`, environment-selected executables, and general-purpose URL opening
remain forbidden. Source and packed-bundle policy checks fail the build if this boundary drifts.
Browser failure is nonfatal and leaves the exact validated manual URL available. JSON, pipes, CI,
non-TTY commands, help, version, anonymous mode, `--no-prompt`, `--no-open`, and
`GITMOG_NO_BROWSER=1` never launch a browser.

Private Context is a separate trust boundary. It uses a distinct public GitHub App with device
flow, repository metadata read, contents read, no other permission, no webhook, no private key,
and no client secret. Its user access token is held in a one-use in-memory lease and cannot enter
the public request planner, collector, snapshots, source/quality caches, battle key, evidence
identity, or request telemetry. Any refresh token returned by GitHub is discarded. The app token
never enters process arguments, environment files, Keychain, npm configuration, logs, JSON,
exports, or caches.

The app installation must report `repository_selection = selected`; all-repository installations
are refused before repository listing. The authenticated login must match exactly one participant.
Private collection uses bounded REST metadata, immutable trees/blobs, releases, and GitHub-linked
path commits only. It never requests issues, pull requests, Discussions, Actions, logs, secrets,
environments, deployments, collaborators, members, billing, administration, or webhooks.

Private source uses the existing parser boundary with stricter collection sensitivity: at most five
selected repositories, 18 files, 20 KiB decoded per file, 300 KiB per profile, 64 requests per
invocation, 12 per repository, and 12 attribution requests. Source, repository names/owners,
paths, URLs, IDs, SHAs, commit messages, derived features, receipts, and private request plans are
process-only. No persistent private cache exists. Only source-free aggregate counts and separate
`P` receipts may cross into output; every mixed artifact passes the private-output scanner.

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
