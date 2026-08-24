# Recorded GitHub responses

Real, unauthenticated responses from `api.github.com`, recorded on **2026-08-13** and
trimmed to a few entries each. They exist so the normalizers are tested against the
shape GitHub actually returns rather than the shape this repository assumes.

| File             | Request                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `user.json`      | `GET /users/octocat`                                                 |
| `repos.json`     | `GET /users/octocat/repos?per_page=100&sort=pushed&type=owner` (3)   |
| `tree.json`      | `GET /repos/octocat/Spoon-Knife/git/trees/main?recursive=1`          |
| `languages.json` | `GET /repos/octocat/Spoon-Knife/languages`                           |
| `releases.json`  | `GET /repos/octocat/Spoon-Knife/releases?per_page=10`                |
| `events.json`    | `GET /users/torvalds/events/public?per_page=100` (6)                 |
| `commits.json`   | `GET /repos/torvalds/linux/commits?author=torvalds&per_page=100` (6) |

`octocat` has no public events, so the events recording comes from a busy account
instead. `commits.json` keeps only the fields this product reads.

**No authorization header was used or recorded.** Every request was anonymous, and
every byte here is publicly readable without an account.

## The finding these recordings exist to pin

`PushEvent` payloads on the **public** events endpoint contain
`{repository_id, push_id, ref, head, before}` and no `commits`, `size` or
`distinct_size`. Commit-level evidence therefore comes from the commits endpoint, one
sampled repository per profile. See ADR 0004 D3 and D3a. If GitHub restores those
fields, `events.json` is where the change will show up first.
