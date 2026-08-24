# Testing

Default tests are offline, deterministic, and synthetic. The in-process network guard blocks
non-loopback fetch, HTTP, socket, and DNS APIs. Fork pull requests receive no secrets and do not
perform live GitHub collection.

```sh
node scripts/turbo.mjs run test --filter=@gitmog/cli
pnpm test
pnpm build
pnpm package:acceptance
pnpm verify
```

`pnpm verify` is the merge gate. Package acceptance builds the exact zero-dependency artifact
outside the checkout, installs it into disposable storage with scripts disabled, and exercises
both bins and supported surfaces. Quality fixtures and calibration schemas have independent
commands so a test pass cannot masquerade as human calibration.
