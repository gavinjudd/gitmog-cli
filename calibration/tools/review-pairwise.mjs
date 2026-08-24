#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

const SCHEMA_VERSION = "1.0.0-blinded-pairwise";
const TOOL_VERSION = "1.0.0";
const MAX_FILE_BYTES = 20 * 1024;
const MAX_SIDE_BYTES = 150 * 1024;

const fail = (message) => {
  throw new Error(`Calibration review stopped safely: ${message}`);
};

const parseJsonFile = (path, label) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fail(`${label} is missing or malformed.`);
  }
};

const isId = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,79}$/u.test(value);
const isLanguage = (value) => ["typescript", "javascript", "python", "go"].includes(value);

function validateBatch(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail("batch is invalid.");
  if (value.schemaVersion !== SCHEMA_VERSION) fail("batch schema version is unsupported.");
  if (typeof value.calibrationVersion !== "string" || value.calibrationVersion.length === 0)
    fail("calibration version is invalid.");
  if (!isId(value.batchId)) fail("batch identifier is invalid.");
  if (!Array.isArray(value.pairs) || value.pairs.length < 1 || value.pairs.length > 200)
    fail("batch pair count is outside the reviewed bound.");
  const pairIds = new Set();
  for (const pair of value.pairs) {
    if (!isId(pair?.pairId) || pairIds.has(pair.pairId)) fail("pair identifiers are invalid.");
    pairIds.add(pair.pairId);
    if (!isLanguage(pair.languageCohort)) fail("language cohort is invalid.");
    if (!Array.isArray(pair.sides) || pair.sides.length !== 2) fail("each pair needs two sides.");
    const sourceIds = new Set();
    for (const side of pair.sides) {
      if (!isId(side?.sourceId) || sourceIds.has(side.sourceId))
        fail("source identifiers are invalid.");
      sourceIds.add(side.sourceId);
      if (
        typeof side.repository !== "string" ||
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(side.repository)
      )
        fail("repository reference is invalid.");
      if (typeof side.commitSha !== "string" || !/^[0-9a-f]{40}$/u.test(side.commitSha))
        fail("immutable commit is invalid.");
      if (!Array.isArray(side.files) || side.files.length < 1 || side.files.length > 7)
        fail("sample file count is outside the reviewed bound.");
      for (const file of side.files) {
        if (typeof file?.sampleLabel !== "string" || !/^sample-[1-7]$/u.test(file.sampleLabel))
          fail("sample label is invalid.");
        if (
          typeof file.path !== "string" ||
          file.path.length === 0 ||
          file.path.length > 500 ||
          file.path.startsWith("/") ||
          file.path.split("/").includes("..") ||
          file.path.includes("\\")
        )
          fail("sample path is unsafe.");
        if (!isLanguage(file.language) || !["implementation", "test"].includes(file.role))
          fail("sample metadata is invalid.");
      }
    }
  }
  return value;
}

const digestHex = (...parts) => createHash("sha256").update(parts.join("\0"), "utf8").digest("hex");

const orderPair = (pair, calibrationVersion, batchId, reviewerPseudonym) => {
  const flip =
    Number.parseInt(
      digestHex(calibrationVersion, batchId, reviewerPseudonym, pair.pairId).slice(0, 2),
      16,
    ) % 2;
  return flip === 0 ? pair.sides : [pair.sides[1], pair.sides[0]];
};

const rawUrl = (side, path) => {
  const [owner, repository] = side.repository.split("/");
  const segments = path.split("/").map((segment) => encodeURIComponent(segment));
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${side.commitSha}/${segments.join("/")}`;
};

async function fetchBoundedText(url) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok || response.body === null)
    fail("a bounded public source sample is unavailable.");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES)
    fail("a bounded public source sample exceeds 20 KiB.");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    bytes += item.value.byteLength;
    if (bytes > MAX_FILE_BYTES) {
      await reader.cancel();
      fail("a bounded public source sample exceeds 20 KiB.");
    }
    chunks.push(item.value);
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(joined), bytes };
  } catch {
    return fail("a bounded public source sample is not UTF-8.");
  }
}

async function loadSide(side) {
  const samples = [];
  let bytes = 0;
  for (const file of side.files) {
    const loaded = await fetchBoundedText(rawUrl(side, file.path));
    bytes += loaded.bytes;
    if (bytes > MAX_SIDE_BYTES) fail("a review side exceeds the 150 KiB process-only bound.");
    samples.push({
      label: file.sampleLabel,
      language: file.language,
      role: file.role,
      text: loaded.text,
    });
  }
  return samples;
}

const showSide = (label, samples) => {
  process.stdout.write(`\n===== SIDE ${label} =====\n`);
  for (const sample of samples) {
    process.stdout.write(`\n--- ${sample.label} · ${sample.language} · ${sample.role} ---\n`);
    process.stdout.write(sample.text);
    process.stdout.write(sample.text.endsWith("\n") ? "" : "\n");
  }
};

const askChoice = async (reader, prompt, values) => {
  while (true) {
    const answer = (await reader.question(prompt)).trim();
    if (values.includes(answer)) return answer;
    process.stdout.write(`Choose one of: ${values.join(", ")}\n`);
  }
};

const writeAtomic = (path, value) => {
  const temporary = resolve(dirname(path), `.${basename(path)}.tmp-${String(process.pid)}`);
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, path);
};

const { values } = parseArgs({
  options: {
    batch: { type: "string" },
    "reviewer-key-file": { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});

if (!values.batch || !values["reviewer-key-file"] || !values.output) {
  fail("use --batch, --reviewer-key-file, and --output.");
}

const batchPath = resolve(values.batch);
const keyPath = resolve(values["reviewer-key-file"]);
const outputPath = resolve(values.output);
const batch = validateBatch(parseJsonFile(batchPath, "batch"));
const reviewerKey = readFileSync(keyPath, "utf8").trim();
if (reviewerKey.length < 16) fail("reviewer key must contain at least 16 characters.");
const reviewerPseudonym = `reviewer_${digestHex(SCHEMA_VERSION, reviewerKey).slice(0, 16)}`;

let output = {
  schemaVersion: SCHEMA_VERSION,
  calibrationVersion: batch.calibrationVersion,
  batchId: batch.batchId,
  reviewerPseudonym,
  toolVersion: TOOL_VERSION,
  judgments: [],
};
if (existsSync(outputPath)) {
  const resumed = parseJsonFile(outputPath, "existing judgment output");
  if (
    resumed.schemaVersion !== SCHEMA_VERSION ||
    resumed.calibrationVersion !== batch.calibrationVersion ||
    resumed.batchId !== batch.batchId ||
    resumed.reviewerPseudonym !== reviewerPseudonym ||
    resumed.toolVersion !== TOOL_VERSION ||
    !Array.isArray(resumed.judgments)
  )
    fail("existing judgment output does not match this reviewer and batch.");
  output = resumed;
}

const completed = new Set(output.judgments.map((judgment) => judgment.pairId));
const reader = createInterface({ input: process.stdin, output: process.stdout });
try {
  process.stdout.write(
    "Anonymous Quality Judge calibration. Do not search snippets. Choose insufficient if identity is recognized.\n",
  );
  for (const pair of batch.pairs) {
    if (completed.has(pair.pairId)) continue;
    const ordered = orderPair(pair, batch.calibrationVersion, batch.batchId, reviewerPseudonym);
    let samplesA;
    let samplesB;
    try {
      [samplesA, samplesB] = await Promise.all([loadSide(ordered[0]), loadSide(ordered[1])]);
    } catch {
      output.judgments.push({
        pairId: pair.pairId,
        languageCohort: pair.languageCohort,
        presentedOrder: ordered.map((side) => side.sourceId),
        choice: "insufficient",
        confidence: "low",
        insufficientReason: "source-unavailable",
      });
      writeAtomic(outputPath, output);
      process.stdout.write(
        "Pair recorded as insufficient because bounded source was unavailable.\n",
      );
      continue;
    }
    showSide("A", samplesA);
    showSide("B", samplesB);
    const choice = await askChoice(
      reader,
      "Which sample is easier to understand, change, test, and trust? [A/B/tie/insufficient] ",
      ["A", "B", "tie", "insufficient"],
    );
    const confidence = await askChoice(reader, "Confidence [low/medium/high] ", [
      "low",
      "medium",
      "high",
    ]);
    const insufficientReason =
      choice === "insufficient"
        ? await askChoice(
            reader,
            "Reason [sample-too-small/source-unavailable/identity-recognized/language-outside-expertise/other-bounded-review-failure] ",
            [
              "sample-too-small",
              "source-unavailable",
              "identity-recognized",
              "language-outside-expertise",
              "other-bounded-review-failure",
            ],
          )
        : null;
    output.judgments.push({
      pairId: pair.pairId,
      languageCohort: pair.languageCohort,
      presentedOrder: ordered.map((side) => side.sourceId),
      choice,
      confidence,
      insufficientReason,
    });
    writeAtomic(outputPath, output);
    process.stdout.write("Judgment saved locally without source or identity.\n");
  }
  process.stdout.write(
    `Batch complete: ${String(output.judgments.length)} judgment(s). No upload performed.\n`,
  );
} finally {
  reader.close();
}
