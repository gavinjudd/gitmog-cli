# Testing

Default tests are offline, deterministic, and synthetic. The in-process network guard blocks
non-loopback fetch, HTTP, socket, and DNS APIs. Fork pull requests receive no secrets and do not
perform live GitHub collection.

```sh
node scripts/turbo.mjs run test --filter=@gitmog/cli
pnpm test
pnpm build
pnpm package:acceptance
pnpm private-context:policy:check
pnpm verify
```

`pnpm verify` is the merge gate. Package acceptance builds the exact zero-dependency artifact
outside the checkout, installs it into disposable storage with scripts disabled, and exercises
both bins and supported surfaces. Quality fixtures and the informational-only policy have
independent commands so parser behavior, policy, and package acceptance are checked separately.
The required [CLI benchmark](BENCHMARKS.md) gates deterministic request reconciliation while
recording hosted-runner timing as informational evidence.

Private Context tests are offline and synthetic. They cover device polling and denial, empty scope,
one-use token lifetime, selected-installation enforcement, identity binding, personal versus
organization maintenance, author-linked attribution, request/parser bounds, aggregate receipt
closure, complete output scanning, zero persistence, public-result byte invariance, and 60/80/100
column mixed-context surfaces. Public CI receives no GitHub App token and names no private
repository.
