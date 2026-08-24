import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Disposable service state lives outside the repository so a Cursor Cloud image
 * can initialize it during a Build, before the repository is present. */
export const systemStateDir = join(homedir(), ".gitmog");

export const paths = {
  root: repoRoot,
  nodeVersionFile: join(repoRoot, ".node-version"),
  packageJson: join(repoRoot, "package.json"),
  pnpmWorkspace: join(repoRoot, "pnpm-workspace.yaml"),
  lockfile: join(repoRoot, "pnpm-lock.yaml"),
  nodeModules: join(repoRoot, "node_modules"),
  envFile: join(repoRoot, ".env"),
  envExample: join(repoRoot, ".env.example"),
  compose: join(repoRoot, "compose.yaml"),
  localState: join(repoRoot, ".gitmog"),
  toolingDir: join(repoRoot, ".gitmog", "tooling", "pnpm"),
  toolingPnpmBinDir: join(repoRoot, ".gitmog", "tooling", "pnpm", "node_modules", ".bin"),
  toolingPnpmCli: join(
    repoRoot,
    ".gitmog",
    "tooling",
    "pnpm",
    "node_modules",
    "pnpm",
    "bin",
    "pnpm.cjs",
  ),
  toolingPnpmLegacyCli: join(
    repoRoot,
    ".gitmog",
    "tooling",
    "pnpm",
    "lib",
    "node_modules",
    "pnpm",
    "bin",
    "pnpm.cjs",
  ),
  systemState: systemStateDir,
  systemRunDir: join(systemStateDir, "run"),
  systemPgData: join(systemStateDir, "pgdata"),
  systemRedisDir: join(systemStateDir, "redis"),
};

export const COMPOSE_PROJECT = "gitmog-dev";
