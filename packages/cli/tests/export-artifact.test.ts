import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBattle } from "@gitmog/battle";
import type { SourceAnalysisResult, StoryResult } from "@gitmog/source-analysis";
import type { BattleResult } from "@gitmog/scoring";
import {
  createFixtureFetch,
  FIXTURE_NOW_MS,
  PERSONAS,
} from "@gitmog/test-fixtures/github-personas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  EXPORT_SCHEMA_VERSION,
  MAX_EXPORT_BYTES,
  renderBattleExport,
  resolveExportDestination,
  writeBattleExport,
} from "../src/export-artifact.js";
import { PRIVATE_CONTEXT_FIXTURE } from "./private-context-fixture.js";

let battle: BattleResult;
let source: SourceAnalysisResult;
let story: StoryResult;
const scratch = mkdtempSync(join(tmpdir(), "gitmog-export-test-"));

beforeAll(async () => {
  const leftFetch = createFixtureFetch(PERSONAS.strongMaintainer);
  const rightFetch = createFixtureFetch(PERSONAS.manyTinyRepos);
  const result = await runBattle({
    left: PERSONAS.strongMaintainer.login,
    right: PERSONAS.manyTinyRepos.login,
    cache: null,
    now: () => FIXTURE_NOW_MS,
    fetchImpl: (input, init) => {
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return href.toLowerCase().includes(PERSONAS.strongMaintainer.login)
        ? leftFetch(input, init)
        : rightFetch(input, init);
    },
  });
  if (!result.ok) throw new Error(result.error.code);
  battle = result.battle;
  source = result.sourceAnalysis;
  story = result.story;
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const render = (format: "html" | "svg", override = battle): Buffer =>
  renderBattleExport({ battle: override, source, story, version: "0.2.2", format });

describe("self-contained battle exports", () => {
  it.each(["html", "svg"] as const)("renders byte-identical bounded %s", (format) => {
    const first = render(format);
    const second = render(format);
    expect(first.equals(second)).toBe(true);
    expect(first.byteLength).toBeLessThanOrEqual(MAX_EXPORT_BYTES);
    const text = first.toString("utf8");
    expect(text).toContain("Git Mog");
    expect(text).toContain("PUBLIC REPO GAP");
    expect(text).toContain("Coverage");
    expect(text).toContain("npx -y gitmog strongmaintainer sidequester");
    expect(text).not.toMatch(/<script|<iframe|@import|url\s*\(/iu);
    expect(text).not.toContain("/Users/");
    expect(text).not.toContain("C:\\Users\\");
    expect(text).not.toContain("snapshotKey");
    expect(text).not.toContain("battleKey");
  });

  it.each(["html", "svg"] as const)("adds a safe aggregate mixed-context panel to %s", (format) => {
    const text = renderBattleExport({
      battle,
      source,
      story,
      version: "0.4.0",
      format,
      privateContext: PRIVATE_CONTEXT_FIXTURE,
    }).toString("utf8");
    expect(text).toContain("MIXED CONTEXT");
    expect(text).toContain("PUBLIC WINNER");
    expect(text).toContain("3 of 4 analyzed private repositories contain CI configuration.");
    expect(text).toContain(
      "Code-quality sample: 3 repos · 10 parsed files · 61% supported coverage.",
    );
    expect(text).not.toContain("Maintained private code quality is 72");
    expect(text).not.toMatch(/previewScore: \d+/u);
    expect(text).not.toContain("sensitive-private-project");
    expect(text).not.toContain("repositoryId");
    expect(text).not.toContain("sourceUrl");
  });

  it("includes semantic HTML, print rules, CSP, three comparisons, and four to six receipts", () => {
    const html = render("html").toString("utf8");
    expect(html).toContain("<main>");
    expect(html).toContain("@media print");
    expect(html).toContain("Content-Security-Policy");
    expect(html.match(/THREE DECISIVE COMPARISONS/giu)).toHaveLength(1);
    const receiptSection = html.split('id="receipt-heading"')[1] ?? "";
    const receiptCount = receiptSection.match(/<li>/gu)?.length ?? 0;
    expect(receiptCount).toBeGreaterThanOrEqual(4);
    expect(receiptCount).toBeLessThanOrEqual(6);
    expect(html).not.toMatch(/https?:\/\//u);
  });

  it("includes accessible SVG metadata with no active or remote content", () => {
    const svg = render("svg").toString("utf8");
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-labelledby="title description"');
    expect(svg).toContain('<title id="title">');
    expect(svg).toContain('<desc id="description">');
    expect(svg).not.toMatch(/<script|<foreignObject|href=|url\s*\(/iu);
    expect(svg.match(/https?:\/\/[^\s"]+/gu)).toEqual(["http://www.w3.org/2000/svg"]);
  });

  it("escapes HTML, XML, CSS-breaking text, controls, and Unicode", () => {
    const unsafe = {
      ...battle,
      left: {
        ...battle.left,
        username: '混合</style><script>alert("x")</script>{color:red}\u001b[2J',
      },
    };
    for (const format of ["html", "svg"] as const) {
      const text = render(format, unsafe).toString("utf8");
      expect(text).toContain("混合");
      expect(text).toContain("&lt;/style&gt;&lt;script&gt;");
      expect(text).toContain("\\x1b[2J");
      expect(text).not.toContain("<script>alert");
      expect(text).not.toContain("</style><script>");
    }
  });

  it("keeps maximum-length handles and limited presentation explicit", () => {
    const maximum = "a".repeat(39);
    const limited = {
      ...battle,
      left: {
        ...battle.left,
        username: maximum,
        confidence: { ...battle.left.confidence, measuredWeight: 49 },
      },
      right: {
        ...battle.right,
        confidence: { ...battle.right.confidence, measuredWeight: 90 },
      },
    };
    for (const format of ["html", "svg"] as const) {
      const text = render(format, limited).toString("utf8");
      expect(text).toContain(maximum);
      expect(text).toContain("PUBLIC EDGE · LIMITED READ");
      expect(text).not.toContain("NUCLEAR REPO GAP");
    }
  });

  it("resolves POSIX, Windows drive, UNC, and space-containing paths lexically", () => {
    expect(
      resolveExportDestination("reports/battle result.html", {
        cwd: "/tmp/gitmog",
        platform: "darwin",
      }),
    ).toMatchObject({
      ok: true,
      value: { path: "/tmp/gitmog/reports/battle result.html", format: "html" },
    });
    expect(
      resolveExportDestination("results\\battle.svg", {
        cwd: "D:\\work\\Git Mog",
        platform: "win32",
      }),
    ).toMatchObject({
      ok: true,
      value: { path: "D:\\work\\Git Mog\\results\\battle.svg", format: "svg" },
    });
    expect(
      resolveExportDestination("\\\\server\\share\\battle.html", {
        cwd: "C:\\work",
        platform: "win32",
      }),
    ).toMatchObject({
      ok: true,
      value: { path: "\\\\server\\share\\battle.html", format: "html" },
    });
  });

  it.each(["", " battle.html", "battle.html ", "battle.txt", "bad\npath.svg"])(
    "rejects invalid destination %j",
    (destination) => {
      expect(resolveExportDestination(destination, { cwd: scratch, platform: "darwin" }).ok).toBe(
        false,
      );
    },
  );

  it("writes atomically, reports metadata, and refuses an existing destination", () => {
    const destination = join(scratch, "nested space", "battle.html");
    const written = writeBattleExport({
      battle,
      source,
      story,
      version: "0.2.2",
      format: "html",
      destination,
    });
    expect(written).toMatchObject({
      ok: true,
      value: { format: "html", schemaVersion: EXPORT_SCHEMA_VERSION },
    });
    if (!written.ok) throw new Error(written.error);
    expect(written.value.bytes).toBe(readFileSync(written.value.path).byteLength);
    expect(written.value.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(lstatSync(written.value.path).isFile()).toBe(true);
    const duplicate = writeBattleExport({
      battle,
      source,
      story,
      version: "0.2.2",
      format: "html",
      destination,
    });
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) throw new Error("existing destination was overwritten");
    expect(duplicate.error).toContain("already exists");
  });

  it.skipIf(process.platform !== "win32")(
    "preserves native Windows absolute paths through filesystem validation",
    () => {
      const destination = join(scratch, "windows-native.svg");
      const written = writeBattleExport({
        battle,
        source,
        story,
        version: "0.2.2",
        format: "svg",
        destination,
      });
      expect(written).toMatchObject({ ok: true, value: { path: destination, format: "svg" } });
    },
  );

  it("refuses a symlink destination", () => {
    const target = join(scratch, "symlink-target.html");
    const destination = join(scratch, "symlink-destination.html");
    writeFileSync(target, "safe", "utf8");
    symlinkSync(target, destination);
    const result = writeBattleExport({
      battle,
      source,
      story,
      version: "0.2.2",
      format: "html",
      destination,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("symlink destination was written");
    expect(result.error).toContain("symbolic link");
    expect(readFileSync(target, "utf8")).toBe("safe");
  });

  it("cleans its temporary file when the atomic commit is interrupted", () => {
    const destination = join(scratch, "interrupted.svg");
    const result = writeBattleExport({
      battle,
      source,
      story,
      version: "0.2.2",
      format: "svg",
      destination,
      commit: () => {
        throw new Error("synthetic interruption");
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("interrupted export was committed");
    expect(result.error).toContain("atomically");
    expect(existsSync(destination)).toBe(false);
    expect(readdirSync(scratch).some((entry) => entry.includes("interrupted.svg.gitmog"))).toBe(
      false,
    );
  });

  it("fails closed when a read-only filesystem refuses its atomic file", () => {
    const parent = join(scratch, "read-only");
    const destination = join(parent, "battle.svg");
    mkdirSync(parent, { recursive: true });
    const result = writeBattleExport({
      battle,
      source,
      story,
      version: "0.2.2",
      format: "svg",
      destination,
      reserve: () => {
        throw Object.assign(new Error("synthetic read-only filesystem"), { code: "EACCES" });
      },
    });
    expect(result.ok).toBe(false);
    expect(existsSync(destination)).toBe(false);
    expect(render("svg").equals(render("svg"))).toBe(true);
  });
});
