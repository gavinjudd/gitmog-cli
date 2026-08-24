# Contributing to Git Mog

Git Mog welcomes code, documentation, fixtures, accessibility work, and careful defect
reports. Start with an issue when a change affects scoring, quality metrics, language support,
security boundaries, packaging, or public output.

## Set up

Use Node 24.19.0 and Git on macOS, Linux, or native Windows:

```sh
node scripts/bootstrap.mjs
pnpm run doctor
pnpm test
```

Before opening a pull request, run `pnpm verify`. Run one package test while iterating, for
example `node scripts/turbo.mjs run test --filter=@gitmog/cli`. The Turbo wrapper builds the
focused package's workspace dependencies first, including in a fresh clone. The complete gate
formats, lints, typechecks, tests, builds, validates community/calibration fixtures, and accepts
the packed package.

## Make a useful change

Explain the observed defect, the owning contract, and the expected behavior. Behavioral
changes require tests. Quality-metric changes require a synthetic fixture and a calibration-
impact note. New language lanes follow `docs/ADDING_A_LANGUAGE.md` and cannot be claimed until
parser, safety, portability, fixture, package, and calibration coverage gates pass.

Documentation contributors do not need to modify code. Use the documentation issue form and
include the exact page, confusing text, intended reader, and proposed outcome.

## AI-assisted contributions

AI-assisted work is allowed, but the human contributor owns every line, claim, license,
security consequence, and test result. Bulk automated pull requests are prohibited. Model-
generated calibration judgments are prohibited and never count as human review. Do not paste
private source, raw target source, credentials, prompts containing secrets, or personal data
into issues, tools, or pull requests.

## Quality reports

A false positive means a supported metric fired incorrectly. Missing coverage means the
language, syntax, sample, or attribution evidence was unavailable; it is not automatically a
false negative. Use the dedicated issue form, cite a public repository and immutable commit,
identify the parser lane and safe path, and provide the smallest reproduction that does not
copy source into the issue.

## Pull requests and licensing

Keep changes focused and use the pull-request template. Fork pull requests receive no secrets
and run only offline synthetic tests. By submitting a contribution, you agree that it is
licensed under this repository's MIT license. No contributor license agreement is required.
