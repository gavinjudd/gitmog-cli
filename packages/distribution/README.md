# Git Mog

```powershell
npx -y gitmog alice bob
```

The standalone package compares public GitHub work for entertainment. One username gives
a profile read; two start a battle. It has both `gitmog` and `git-mog` binary names, zero
runtime dependencies, and needs no credential when the anonymous GitHub allowance fits.

Releases come from [Incit-AI/Git-Mog](https://github.com/Incit-AI/Git-Mog). Temporary
repository-scoped self-hosted Mac and Windows runners verify the exact candidate without
publishing it. A maintainer stages that audited tarball through an authenticated npm
session, downloads it for independent comparison, and approves it with two-factor
authentication. No long-lived npm token is used.

```powershell
npx -y gitmog alice
npx -y gitmog @alice
npx -y gitmog https://github.com/alice https://github.com/bob
npx -y gitmog alice bob --card
npx -y gitmog alice bob --details
npx -y gitmog alice bob --receipts
npx -y gitmog alice bob --json
npx -y gitmog alice bob --export battle.html
npx -y gitmog alice bob --export battle.svg
npx -y gitmog --cache-info
npx -y gitmog --clear-cache
```

Run bare `npx -y gitmog` for the short guide. It explains score coverage in plain
language and keeps advanced flags under `--help-all`. Exact profile URLs normalize to the
same identity as usernames; repository and unsafe URLs fail locally with no GitHub call.

Before a cold collection, Git Mog checks whether the cache-aware request plan fits the
current GitHub allowance. If it does not, an interactive terminal may offer one-time
device sign-in. That flow asks for no scope or client secret and keeps the token in memory
for the current process only. JSON and noninteractive commands never prompt.

Git Mog's platform-native cache is capped at 25 MiB. `--cache-info` reports its exact path
and usage without contacting GitHub; `--clear-cache` removes only that validated Git Mog
cache root and is safe to run more than once. Add `--json` to either command for structured
output. Raw source is never stored. npm's general cache remains separate and is not changed.

Human verdict language follows public-score coverage without changing the canonical score,
winner, margin, or JSON verdict fields. `--export <path>` creates a deterministic,
self-contained, script-free HTML or SVG battle with no remote assets or requests. It writes
atomically and refuses to overwrite an existing or symlink destination; combine it with
`--json` for path, byte, schema, format, and SHA-256 metadata.

## Try a famous matchup

```powershell
npx -y gitmog torvalds gvanrossum
npx -y gitmog karpathy geohot
```

Public profiles. No affiliation or endorsement implied.

The source pass never executes or persists target code. Unsupported languages lower
coverage. Versioned source analysis informs the matchup read and remains separate from the
numeric score. There is no LLM and no higher-quality mode.

Default human output leads with the result, scores, public-score coverage, three plain-language
fight rows, concise factual player reads, and four to six claim-specific receipts. Internal
classifier identities never appear on human surfaces. `--details` adds axes, status, coverage,
limitations, and the full human breakdown; `--receipts` adds every raw receipt and source
sample. Compatible classifier fields remain available in JSON.

Interactive human profile and battle runs show one transient status line driven by real
analysis transitions, then clear it before the result. JSON, cards, captions, shares,
help, version, pipes, CI, and non-TTY output stay clean. Set `GITMOG_NO_MOTION=1` for the
same replaceable phases with no spinner or cursor control. No progress path adds a delay
or changes the deterministic result.

Licensed under the MIT License.
