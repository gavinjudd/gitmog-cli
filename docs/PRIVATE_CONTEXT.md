# Private Context

Git Mog battles remain public-only by default. The optional command

```sh
npx -y gitmog alice bob --private-context
```

adds a separate, aggregate reading for the authenticated participant. It never changes the
PUBLIC BATTLE score, score coverage, category scores, rounds, winner, margin, finishing move,
verdict, evidence, source analysis, Code DNA, Code Quality Preview, battle key, cache identity, or
request-plan identity. Every mixed result identifies the participant who added context and states
that the PUBLIC WINNER uses public evidence.

`--public-only` suppresses every private prompt and endpoint. `--anonymous` implies public-only.
The two public-only modes cannot be combined with `--private-context`.

## Separate GitHub App

Private Context uses the public **Git Mog Private Context** GitHub App, not the public-capacity
OAuth App. The app has only repository metadata read and contents read permission. It has no
organization or account permissions, webhook, private key, client secret, or write/admin access.
Device authorization returns a user access token that stays in process memory for one invocation.
Any returned refresh token is discarded.

- App slug: `git-mog-private-context`
- App ID: `4711250`
- Client ID: `Iv23liwSgKr5V8w6Qo7m`
- Installation: <https://github.com/apps/git-mog-private-context/installations/new>

Install the app from its GitHub installation page and choose **Only select repositories**. Git Mog
refuses installations configured for all repositories; it never silently narrows one. An
organization installation may require an owner to approve it. Revoke or change the installation
at any time through GitHub's Installed GitHub Apps settings.

During an interactive run, Git Mog opens the reviewed installation or settings page only after
the user chooses Private Context. Enter rechecks the installation in the same command, `p`
continues public-only, and `q` cancels. The session-only token remains in memory during at most
three rechecks and is discarded on every exit path. `--no-open` and
`GITMOG_NO_BROWSER=1` keep the manual link path without launching a browser.

The authenticated GitHub login must exactly match one requested participant. A match to neither
participant, both participants, or an alternate supplied identity is refused before repository
access. Private Context cannot be added for the opponent.

## Collection and privacy boundary

One invocation considers at most five deliberately selected private/internal repositories, ranked
deterministically by substance and recent activity without stars or public popularity. Collection
uses bounded GitHub REST metadata, immutable trees/blobs, releases, and user-linked path commits.
It never requests issues, pull requests, Discussions, Actions, logs, secrets, deployments,
collaborators, members, billing, administration, or webhooks. It never clones, installs, imports,
builds, tests, evaluates, or executes target code.

Source is decoded only inside the process and sent through the existing TypeScript/JavaScript
parser safety boundary: 20 KiB per file, 300 KiB per profile, 18 files, 500 ms per file, and two
seconds per profile. Private source, repository metadata, paths, URLs, IDs, SHAs, commit messages,
derived features, quality results, receipts, and request plans are never written to disk. Private
Context has no persistent cache, and `--cache-info` / `--clear-cache` operate only on public data.

Normal output, JSON, cards, shares, HTML/SVG exports, errors, logs, CI artifacts, and release assets
receive only source-free aggregate counts. Default terminal output uses complete aggregate claims
without unresolved markers. `--receipts` adds a separately labeled `PRIVATE AGGREGATES` section
whose `P1`, `P2`, ... entries remain distinct from publicly checkable receipts. Repository names,
owners, paths, URLs, IDs, source excerpts, commit IDs/messages, email, organization names, and
installation IDs are prohibited.

## Codebase eligibility and authorship

A personal repository owned by the authenticated account, or an organization repository where
GitHub reports maintain/admin permission, may contribute to **maintained codebase**. Read, pull, or
push access alone does not establish maintenance.

**Attributed code** requires a GitHub-linked author identity on bounded commits touching sampled
paths. Git Mog does not infer authorship from email, a person's name, commit message, committer,
organization membership, or repository access. An organization repository can therefore be
attribution-only. Insufficient attribution is neutral.

Private Context measures only the selected repositories and supported source that qualified within
these bounds. It does not measure all private work, does not produce a private winner, and is not
independently checkable by viewers.

Ordinary human surfaces describe whether the selected codebase was read and whether GitHub-linked
authorship was matched. They show the bounded code sample as readable file counts rather than a
percentage that could be mistaken for whole-repository coverage. `--details` and
structured JSON retain that score and label it `selected-sample`, `informational`,
`scoreInfluence: 0`, `publicWinnerInfluence: 0`, and `persisted: false`.
