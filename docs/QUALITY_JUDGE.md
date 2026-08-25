# Quality Judge

Quality Judge is a separate, versioned static-analysis preview in v0.4.0. It evaluates
two noninterchangeable readings:

- **Maintained codebase:** engineering qualities in repositories a profile publicly owns or
  materially maintains.
- **Attributed code:** only sampled code with bounded public commit evidence linked to the
  profile. Missing attribution is not negative evidence.

It must use reviewed real parsers for activated languages. Unsupported or unsafe syntax lowers
coverage rather than score. Every visible finding requires a same-response safe receipt; no
receipt contains source excerpts. Target code is never executed and raw source is never
persisted.

The preview attaches only after the canonical battle is complete. It has `scoreInfluence: 0` and
cannot alter the score, basis, coverage, rounds, winner, margin, verdict, evidence, battle key,
existing JSON battle fields, or canonical cache identity. Its policy has one informational-only
state and no enabled branch. See [QUALITY_VALIDATION.md](QUALITY_VALIDATION.md).
Reduced synthetic parser and metric defects are accepted through the
[Quality Judge feedback route](QUALITY_FEEDBACK.md).

## Supported lanes and bounds

TypeScript and JavaScript use the real TypeScript 6.0.3 compiler AST. Python and Go are
unsupported: their files lower coverage and cannot produce quality claims. The parser decision and
deferred candidates are recorded in [ADR 0002](decisions/0002-parser-backed-quality-preview.md).

Per profile, selection is limited to three substantial repositories, five implementation and two
test files per repository, 18 files total, 20 KiB decoded per file, and 300 KiB decoded source in
process. At most 21 quality-source and 12 attribution requests are planned. The parser worker caps
each file at 500 ms, the profile at two seconds, and enforces heap, stack, node, depth, import,
symbol, and token limits.

Anonymous automatic analysis uses one fixed five-source-request tier per profile when capacity
permits. Authenticated analysis uses the complete 21-source plus 12-attribution tier when capacity
permits. Cache hits may save calls but never promote a profile to a larger tier, and opponent or
repository ordering cannot change its tier. Planned opportunity and current-invocation telemetry
are reported separately; a whole-result cache hit reports zero current HTTP calls.

The request planner separately reports planned additional calls, supported-language opportunity,
eligible-file opportunity, attribution opportunity, and a typed limitation reason. Sign-in is
offered only when more requests can materially improve the reading; it cannot overcome absent or
exhausted TypeScript/JavaScript source. Private Context reuses the same parser bounds but returns a
separate source-free aggregate reading and never enters the public Quality Preview object.

The separate 29-point instrument normalizes only across available dimensions and reports the
result as `previewScore` with coverage. It never enters the reserved canonical scorecard points.
Every visible strength or weakness cites a safe receipt in the same response; `--details` expands
dimensions and limitations, while `--receipts` includes every safe public URL without source text.
