import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

const OPEN_MODULE = "packages/cli/src/open-external.ts";
const EXPECTED_DESTINATION_FRAGMENTS = [
  "/login/device",
  "/apps/git-mog-private-context/installations/new",
  "PRIVATE_SETTINGS_PATH",
];
const EXPECTED_EXECUTABLES = [
  "/usr/bin/open",
  String.raw`C:\\Windows\\System32\\rundll32.exe`,
  "/usr/bin/xdg-open",
];

/** @param {string} directory @returns {string[]} */
const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(entry.parentPath, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

/** @param {string[]} failures @param {string} message */
const fail = (failures, message) => failures.push(message);

/** @param {string} root @returns {string[]} */
export function browserOpenSourcePolicyFailures(root) {
  /** @type {string[]} */
  const failures = [];
  const runtimeDirectories = [
    "analyzers",
    "battle",
    "cli",
    "github",
    "personality",
    "private-context",
    "quality-judge",
    "scoring",
    "source-analysis",
  ].map((name) => resolve(root, "packages", name, "src"));
  const importers = runtimeDirectories
    .flatMap(walk)
    .filter((path) => readFileSync(path, "utf8").includes("node:child_process"));
  const importerNames = importers.map((path) => relative(root, path));
  if (JSON.stringify(importerNames) !== JSON.stringify([OPEN_MODULE])) {
    fail(
      failures,
      `node:child_process importers must be exactly ${OPEN_MODULE}; found ${importerNames.join(", ") || "none"}`,
    );
  }
  const sourcePath = resolve(root, OPEN_MODULE);
  const source = readFileSync(sourcePath, "utf8");
  if (!/^import \{ spawn \} from "node:child_process";$/mu.test(source)) {
    fail(failures, "browser opener must import only spawn from node:child_process");
  }
  /** @type {readonly (readonly [string, RegExp])[]} */
  const forbiddenSource = [
    ["exec capability", /(?<![\w.])exec(?:File|Sync)?\s*\(/u],
    ["fork capability", /(?<![\w.])fork\s*\(/u],
    ["spawnSync capability", /(?<![\w.])spawnSync\s*\(/u],
    ["shell execution", /shell\s*:\s*true/u],
    ["environment-selected browser", /process\.env\.(?:BROWSER|browser)|\bBROWSER\b/u],
    ["PowerShell command", /powershell|pwsh/iu],
    ["Windows shell command", /cmd\.exe/iu],
    ["general URL opener", /(?:openUrl|openURL|launchUrl|launchURL)\s*\(/u],
  ];
  for (const [label, pattern] of forbiddenSource) {
    if (pattern.test(source)) fail(failures, `browser opener contains ${label}`);
  }
  for (const destination of EXPECTED_DESTINATION_FRAGMENTS) {
    if (!source.includes(destination)) fail(failures, `browser opener omitted ${destination}`);
  }
  for (const executable of EXPECTED_EXECUTABLES) {
    if (!source.includes(executable)) fail(failures, `browser opener omitted ${executable}`);
  }
  for (const invariant of [
    "validateExternalDestination(destination)",
    "spawn(command.executable, [...command.args]",
    'cwd: process.platform === "win32" ? "C:\\\\Windows\\\\System32" : "/"',
    "detached: true",
    "env: browserProcessEnvironment(process.platform, process.env)",
    'stdio: "ignore"',
    "windowsHide: true",
    "shell: false",
    "child.unref()",
  ]) {
    if (!source.includes(invariant)) fail(failures, `browser opener omitted ${invariant}`);
  }
  for (const forbiddenEnvironmentName of [
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "TOKEN",
    "SECRET",
    "PASSWORD",
    "CREDENTIAL",
  ]) {
    if (source.includes(`"${forbiddenEnvironmentName}"`))
      fail(failures, `browser opener environment includes ${forbiddenEnvironmentName}`);
  }
  return failures;
}

/** @param {string} root */
export function assertBrowserOpenSourcePolicy(root) {
  const failures = browserOpenSourcePolicyFailures(root);
  if (failures.length > 0)
    throw new Error(`Browser-open source policy failed:\n- ${failures.join("\n- ")}`);
}
