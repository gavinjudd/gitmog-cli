# Build and verification

Requirements: Node 24.19.0 and pnpm 11.21.0.

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm test
```

The acceptance command builds `packages/distribution`, packs it outside the checkout, requires exactly six package members, installs that tarball into a disposable project, and runs offline fixture acceptance. Compare package member bytes and the tarball hash against the release checksums supplied with the audited release candidate.

Development dependencies are exactly pinned in `package.json` and `pnpm-lock.yaml`. The packed package has zero runtime dependencies and no lifecycle install behavior.
