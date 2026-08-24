#!/usr/bin/env node

// This target exists before TypeScript is built, so pnpm can create the workspace bin
// link during a clean bootstrap. The implementation remains the compiled CLI.
await import("../dist/bin.js");
