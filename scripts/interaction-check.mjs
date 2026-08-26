#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(resolve(root, ...parts), "utf8").replaceAll("\r\n", "\n");
const output = (name) => read("packages/cli/tests/fixtures/terminal-output", `${name}.txt`);
const interaction = (name) => read("packages/cli/tests/fixtures/interaction", `${name}.txt`);
const failures = [];
const requireFact = (condition, message) => {
  if (!condition) failures.push(message);
};

const help = read("packages/cli/tests/fixtures/terminal-progress/help.txt");
const helpLines = help.split("\n");
requireFact(helpLines.indexOf("  npx -y gitmog <left> <right>") >= 0, "help lacks battle command");
requireFact(
  helpLines.indexOf("  npx -y gitmog <left> <right>") < 5,
  "help command is below line five",
);
requireFact(helpLines.length - 1 <= 30, "help exceeds one 80-column screen");
requireFact(
  helpLines.every((line) => Array.from(line).length <= 80),
  "help exceeds 80 columns",
);

const battle = output("battle-width-80");
const battleLines = battle.trim().split("\n");
requireFact(
  /^◆ .* (?:WINS|TIE) \d+–\d+/u.test(battleLines[1] ?? ""),
  "battle line two lacks winner and score",
);
requireFact((battleLines[2] ?? "").startsWith("Coverage:"), "battle line three lacks coverage");
requireFact(battle.includes("Rematch: gitmog "), "battle lacks rematch command");
requireFact(battle.includes("Next: gitmog "), "battle lacks next battle command");

const mixed = output("battle-mixed");
const mixedLines = mixed.trim().split("\n");
requireFact(
  (mixedLines[2] ?? "").startsWith("Public coverage:"),
  "mixed line three lacks public coverage",
);
requireFact(
  mixedLines.slice(3, 5).join(" ").startsWith("Context:"),
  "mixed disclosure is not immediately after coverage",
);
requireFact(
  mixedLines.slice(3, 5).join(" ").includes("public repos only"),
  "mixed disclosure does not answer winner influence",
);

const rate = interaction("rate-limit-choice");
for (const fact of [
  "GITHUB LIMIT",
  "almost out",
  "22 left",
  "may need 32",
  "[Enter] sign in once",
  "[l] smaller read",
  "[q] cancel",
]) {
  requireFact(rate.includes(fact), `rate-limit choice lacks ${fact}`);
}

const publicAuth = interaction("public-auth-opened");
for (const fact of [
  "why",
  "Private repos are not included.",
  "Enter this code:",
  "[Enter] open again",
  "[q] cancel",
]) {
  requireFact(
    fact === "why" ? publicAuth.includes("finish the full public read") : publicAuth.includes(fact),
    `public authorization lacks ${fact}`,
  );
}
const fallback = interaction("public-auth-fallback");
requireFact(
  fallback.split("\n").includes("Open this link: https://github.com/login/device"),
  "no-open fallback lacks exact manual URL",
);
requireFact(fallback.includes("[Enter] try again"), "browser failure lacks retry action");

const privateAuth = interaction("private-auth");
for (const fact of [
  "only the private repos you selected",
  "No write access.",
  "No GitHub Secrets access.",
  "No code execution.",
  "Access ends when this run ends.",
]) {
  requireFact(privateAuth.includes(fact), `private authorization lacks ${fact}`);
}
for (const name of ["private-setup-install", "private-setup-settings"]) {
  const setup = interaction(name);
  requireFact(
    setup.includes("Only select repositories"),
    `${name} lacks selected-repository instruction`,
  );
  requireFact(setup.includes("[p] continue public-only"), `${name} lacks public-only recovery`);
  requireFact(setup.includes("[q] cancel"), `${name} lacks cancellation`);
}

const interactionTest = read("packages/cli/tests/authorization-interaction.test.ts");
for (const contract of [
  "caps five reopens",
  "keeps opener failure nonfatal",
  "--no-open",
  "environment opt-out",
  "non-TTY stdin",
  "q cancels polling",
  "rechecks a missing installation",
  "continues public-only when p is selected",
  "without printing its identifier",
]) {
  requireFact(interactionTest.includes(contract), `test suite lacks ${contract}`);
}

if (failures.length > 0) {
  throw new Error(`Interaction check failed:\n- ${failures.join("\n- ")}`);
}
console.log(
  "Interaction check complete (help, result hierarchy, five first-time-user questions, authorization actions, no-open fallback, setup continuation, and cleanup test contracts passed).",
);
