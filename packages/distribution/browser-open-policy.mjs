const EXPECTED_DESTINATION_FRAGMENTS = [
  "/login/device",
  "/apps/git-mog-private-context/installations/new",
];
const EXPECTED_EXECUTABLES = [
  "/usr/bin/open",
  String.raw`C:\\Windows\\System32\\rundll32.exe`,
  "/usr/bin/xdg-open",
];

/** @param {string[]} failures @param {string} message */
const fail = (failures, message) => failures.push(message);

/** @param {string} bundle @param {string} [parserBundle] @returns {string[]} */
export function browserOpenBundlePolicyFailures(bundle, parserBundle = "") {
  /** @type {string[]} */
  const failures = [];
  const imports = [...bundle.matchAll(/from\s+["']node:child_process["']/gu)];
  if (imports.length !== 1) {
    fail(failures, `packed bundle must contain one child-process import; found ${imports.length}`);
  }
  if (!/import\s*\{\s*spawn\s*\}\s*from\s*["']node:child_process["']/u.test(bundle)) {
    fail(failures, "packed bundle must import only spawn from node:child_process");
  }
  if (parserBundle.includes("node:child_process")) {
    fail(failures, "parser bundle contains child-process capability");
  }
  /** @type {readonly (readonly [string, RegExp])[]} */
  const forbiddenBundle = [
    ["exec capability", /(?<![\w.])exec(?:File|Sync)?\s*\(/u],
    ["fork capability", /(?<![\w.])fork\s*\(/u],
    ["spawnSync capability", /(?<![\w.])spawnSync\s*\(/u],
    ["shell execution", /shell\s*:\s*true/u],
    ["environment-selected browser", /process\.env\.(?:BROWSER|browser)/u],
    ["PowerShell command", /powershell|pwsh/iu],
    ["Windows shell command", /cmd\.exe/iu],
  ];
  for (const [label, pattern] of forbiddenBundle) {
    if (pattern.test(bundle)) fail(failures, `packed bundle contains ${label}`);
  }
  for (const destination of EXPECTED_DESTINATION_FRAGMENTS) {
    if (!bundle.includes(destination)) fail(failures, `packed bundle omitted ${destination}`);
  }
  for (const executable of EXPECTED_EXECUTABLES) {
    if (!bundle.includes(executable)) fail(failures, `packed bundle omitted ${executable}`);
  }
  return failures;
}

/** @param {string} bundle @param {string} [parserBundle] */
export function assertBrowserOpenBundlePolicy(bundle, parserBundle = "") {
  const failures = browserOpenBundlePolicyFailures(bundle, parserBundle);
  if (failures.length > 0)
    throw new Error(`Browser-open bundle policy failed:\n- ${failures.join("\n- ")}`);
}
