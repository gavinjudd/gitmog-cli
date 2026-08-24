import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export const packageAcceptanceEnvironment = (baseEnvironment, npmCache, gitmogCache) => ({
  ...baseEnvironment,
  npm_config_cache: npmCache,
  NPM_CONFIG_CACHE: npmCache,
  GITMOG_CACHE_DIR: gitmogCache,
});

export const canonicalizePackageHelpInvocation = (help) =>
  help
    .replace(/^Installed: git mog /mu, "Installed: gitmog ")
    .replace(/^More options: git mog /mu, "More options: gitmog ")
    .replace(/^( {2})git mog (<left> <right>\r?)$/mu, "$1gitmog $2");

export const PUBLISHED_PACKAGE_FILES = Object.freeze([
  "LICENSE",
  "README.md",
  "bin/gitmog.mjs",
  "dist/build.json",
  "dist/gitmog.mjs",
  "dist/parsers/quality-worker.mjs",
  "package.json",
]);

export async function withPackageAcceptanceScratch(repositoryRoot, task) {
  const scratch = mkdtempSync(join(tmpdir(), "gitmog-package-acceptance-"));
  const relativeToRepository = relative(resolve(repositoryRoot), resolve(scratch));
  if (
    relativeToRepository === "" ||
    (!relativeToRepository.startsWith("..") && !isAbsolute(relativeToRepository))
  ) {
    rmSync(scratch, { recursive: true, force: true });
    throw new Error(`Package-acceptance scratch must be external: ${scratch}`);
  }
  const context = {
    scratch,
    npmCache: join(scratch, "npm-cache"),
    gitmogCache: join(scratch, "gitmog-cache"),
    artifacts: join(scratch, "artifacts"),
    install: join(scratch, "install"),
  };
  for (const directory of [
    context.npmCache,
    context.gitmogCache,
    context.artifacts,
    context.install,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  try {
    return await task(context);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function buildExternalTarball({ npmCli, packageDirectory, context, environment, runCli }) {
  const dryRun = runCli(
    npmCli,
    ["pack", "--dry-run", "--json", "--pack-destination", context.artifacts],
    {
      cwd: packageDirectory,
      env: environment,
    },
  );
  const packed = runCli(npmCli, ["pack", "--json", "--pack-destination", context.artifacts], {
    cwd: packageDirectory,
    env: environment,
  });
  let report;
  let dryRunReport;
  try {
    report = JSON.parse(packed.stdout);
    dryRunReport = JSON.parse(dryRun.stdout);
  } catch {
    throw new Error("npm pack did not return its JSON artifact report.");
  }
  const entry = Array.isArray(report) ? report[0] : undefined;
  const dryRunEntry = Array.isArray(dryRunReport) ? dryRunReport[0] : undefined;
  const filename = entry?.filename;
  if (typeof filename !== "string" || filename === "") {
    throw new Error("npm pack did not report an artifact filename.");
  }
  const tarball = resolve(context.artifacts, basename(filename));
  const relativeArtifact = relative(resolve(context.artifacts), tarball);
  if (
    relativeArtifact === "" ||
    relativeArtifact.startsWith("..") ||
    isAbsolute(relativeArtifact) ||
    !existsSync(tarball) ||
    !tarball.endsWith(".tgz")
  ) {
    throw new Error("npm pack artifact escaped the external disposable root.");
  }
  const packedFiles = Array.isArray(entry?.files)
    ? entry.files.map((file) => file?.path).filter((path) => typeof path === "string")
    : [];
  const dryRunFiles = Array.isArray(dryRunEntry?.files)
    ? dryRunEntry.files.map((file) => file?.path).filter((path) => typeof path === "string")
    : [];
  if (packedFiles.length === 0 || JSON.stringify(packedFiles) !== JSON.stringify(dryRunFiles)) {
    throw new Error("npm pack dry-run and real artifact file lists differ.");
  }
  if (JSON.stringify([...packedFiles].sort()) !== JSON.stringify(PUBLISHED_PACKAGE_FILES)) {
    throw new Error(
      `Packed file allowlist changed. Expected: ${PUBLISHED_PACKAGE_FILES.join(", ")}. ` +
        `Actual: ${[...packedFiles].sort().join(", ")}.`,
    );
  }
  for (const path of packedFiles) {
    const normalized = path.replaceAll("\\", "/").toLowerCase();
    if (
      normalized.includes("/.gitmog/") ||
      normalized.includes("/_cacache/") ||
      normalized.endsWith(".tgz") ||
      /(?:^|-)debug-\d+\.log$/.test(basename(normalized))
    ) {
      throw new Error(`npm pack included generated package state: ${path}`);
    }
  }
  if (
    typeof entry.integrity !== "string" ||
    !entry.integrity.startsWith("sha512-") ||
    typeof entry.shasum !== "string" ||
    !/^[0-9a-f]{40}$/u.test(entry.shasum)
  ) {
    throw new Error("npm pack did not report valid artifact integrity metadata.");
  }
  return {
    tarball,
    bytes: statSync(tarball).size,
    files: packedFiles,
    integrity: entry.integrity,
    shasum: entry.shasum,
  };
}

const walk = (directory, repositoryRoot) => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") return [];
      if (resolve(path) === resolve(repositoryRoot, ".gitmog")) return [];
      const generatedDirectory =
        entry.name === ".gitmog" || entry.name === "_cacache" || entry.name === "content-v2"
          ? [path]
          : [];
      return [...generatedDirectory, ...walk(path, repositoryRoot)];
    }
    return [path];
  });
};

/** Includes ignored files; Git status alone cannot see package-local npm state. */
export function repositoryPackageHygieneFindings(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const findings = [];
  for (const path of walk(root, root)) {
    const normalized = path.replaceAll("\\", "/").toLowerCase();
    const name = basename(path).toLowerCase();
    if (
      name.endsWith(".tgz") ||
      /(?:^|-)debug-\d+\.log$/.test(name) ||
      normalized.endsWith("/.gitmog") ||
      normalized.endsWith("/_cacache") ||
      normalized.endsWith("/content-v2") ||
      normalized.includes("/.gitmog/tooling/npm-cache/") ||
      normalized.includes("/_cacache/content-v2/")
    ) {
      findings.push(path);
    }
  }
  return findings;
}
