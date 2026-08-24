#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "AGENTS.md",
  "README.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "GOVERNANCE.md",
  "MAINTAINERS.md",
  "SECURITY.md",
  "SUPPORT.md",
  ".github/CODEOWNERS",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug.yml",
  ".github/ISSUE_TEMPLATE/feature.yml",
  ".github/ISSUE_TEMPLATE/quality-false-positive.yml",
  ".github/ISSUE_TEMPLATE/quality-false-negative.yml",
  ".github/ISSUE_TEMPLATE/language-support.yml",
  ".github/ISSUE_TEMPLATE/documentation.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/dependabot.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/release.yml",
  ".github/workflows/calibration.yml",
  ".github/workflows/community.yml",
];

for (const path of required) {
  if (!existsSync(resolve(root, path))) throw new Error(`Missing community contract: ${path}`);
}

const workflowRoot = resolve(root, ".github", "workflows");
const workflows = existsSync(workflowRoot)
  ? readdirSync(workflowRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yml"))
      .map((entry) => resolve(entry.parentPath, entry.name))
  : [];
const actionPin = /^\s*-?\s*uses:\s*[^\s@]+@([0-9a-f]{40})(?:\s*#.*)?$/gmu;
for (const workflow of workflows) {
  const contents = readFileSync(workflow, "utf8");
  if (contents.includes("pull_request_target:")) {
    throw new Error(`pull_request_target is forbidden: ${relative(root, workflow)}`);
  }
  if (contents.includes("self-hosted")) {
    throw new Error(`Self-hosted runners are forbidden: ${relative(root, workflow)}`);
  }
  if (
    contents.includes("actions/setup-node@") &&
    !contents.includes("package-manager-cache: false")
  ) {
    throw new Error(
      `setup-node must not probe pnpm before zero-dependency bootstrap: ${relative(root, workflow)}`,
    );
  }
  for (const line of contents.split("\n").filter((value) => value.includes("uses:"))) {
    actionPin.lastIndex = 0;
    if (!actionPin.test(line)) throw new Error(`Action is not SHA-pinned: ${line.trim()}`);
  }
}

for (const issueForm of required.filter(
  (path) => path.endsWith(".yml") && path.includes("ISSUE_TEMPLATE"),
)) {
  const contents = readFileSync(resolve(root, issueForm), "utf8").toLowerCase();
  if (!contents.includes("credential") || !contents.includes("private source")) {
    throw new Error(`Issue form lacks the source/credential warning: ${issueForm}`);
  }
}

const ciWorkflow = readFileSync(resolve(workflowRoot, "ci.yml"), "utf8");
const architectureStart = ciWorkflow.indexOf("\n  architecture:");
const qualityStart = ciWorkflow.indexOf("\n  quality:");
const architectureBlock = ciWorkflow.slice(architectureStart, qualityStart);
if (
  architectureStart < 0 ||
  qualityStart < 0 ||
  !architectureBlock.includes("needs: packed-artifact")
) {
  throw new Error("Architecture acceptance must wait for the exact shared packed artifact.");
}
const qualityEnd = ciWorkflow.indexOf("\n  security:", qualityStart);
const qualityBlock = ciWorkflow.slice(qualityStart, qualityEnd);
if (!qualityBlock.includes("scripts/turbo.mjs run test --filter=@gitmog/quality-judge")) {
  throw new Error("Focused quality CI must build its workspace dependencies through Turbo.");
}

console.log(
  `Community contract complete (${String(required.length)} required files, ${String(workflows.length)} workflows).`,
);
