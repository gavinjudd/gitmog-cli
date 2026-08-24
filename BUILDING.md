# Build and verification

Requirements are Node 24.19.0 and Git. The zero-dependency bootstrap installs pnpm 11.21.0
inside `.gitmog/tooling/pnpm`, then installs the exact frozen dependency graph with lifecycle
scripts disabled.

```sh
node scripts/bootstrap.mjs
pnpm run doctor
pnpm verify
```

Useful focused commands are `pnpm test`, `pnpm build`, `pnpm package:acceptance`,
`pnpm quality:fixtures`, `pnpm quality:calibration:check`, and `pnpm community:check`.
The package-acceptance command packs outside the checkout, installs into disposable storage,
and runs both bins against offline fixtures.
