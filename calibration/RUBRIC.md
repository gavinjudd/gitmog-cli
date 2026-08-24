# Blinded pairwise rubric

For each anonymous pair, answer one question:

> Which sampled codebase is easier to understand, change, test, and trust?

Choose `A`, `B`, `tie`, or `insufficient`, then record confidence as `low`, `medium`, or `high`.
Use `insufficient` when the bounded sample cannot support a comparison, a side fails to load, the
reviewer recognizes a project, or the languages are outside the reviewer's competence.

## Dimensions

Review the bounded sample as a maintained codebase. Apply language and repository context; no
single smell is universally bad.

1. **Correctness discipline** — validation, error propagation, cleanup, failure handling, and
   avoidance of unchecked behavior.
2. **Test quality** — meaningful assertions, failure and edge coverage, isolation, and the
   relationship between tests and implementation.
3. **Maintainability** — understandable control flow, bounded complexity and nesting, cohesive
   functions, and change locality.
4. **Contract quality** — clear public boundaries, types or schemas where appropriate,
   nullability, and language-appropriate documentation.
5. **Architecture** — module cohesion, dependency direction, package boundaries, separation of
   I/O from domain logic, and avoidable cycles or hubs.
6. **Security hygiene** — input bounds, command and query construction, deserialization, path
   safety, dynamic evaluation, and security-appropriate randomness.

Duplication and dead patterns may inform maintainability or architecture but are not a seventh
human activation dimension.

## What reviewers must ignore

Do not infer project identity, popularity, owner, stars, forks, followers, job level, intelligence,
or total engineering ability. Do not reward framework familiarity, formatting preferences,
comments alone, repository fame, or quantity of code. Do not penalize unavailable evidence.

The tool shows only anonymous sides, language, file role, safe relative sample labels, and bounded
source. Reviewers must not search for snippets or otherwise unblind a pair.
