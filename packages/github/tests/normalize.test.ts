import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  isBotName,
  MAX_TREE_ENTRIES,
  normalizeCommits,
  normalizeEvent,
  normalizeLanguages,
  normalizeProfile,
  normalizeReleases,
  normalizeRepository,
  normalizeTree,
} from "../src/normalize.js";

/**
 * Contract test. The inputs are real responses recorded from the public API, so this
 * suite fails if GitHub changes a shape this product depends on — which is exactly how
 * the missing `PushEvent.commits` field was found.
 */
const recorded = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/recorded/rest/${name}.json`, import.meta.url), "utf8"),
  );

describe("normalizers against recorded GitHub responses", () => {
  it("reads a real profile", () => {
    const profile = normalizeProfile(recorded("user"));
    expect(profile?.login).toBe("octocat");
    expect(profile?.htmlUrl).toBe("https://github.com/octocat");
    expect(profile?.avatarUrl).toMatch(/^https:\/\/avatars\.githubusercontent\.com\//);
    expect(profile?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("reads real repositories including the fields eligibility depends on", () => {
    const raw = recorded("repos") as unknown[];
    const repositories = raw.map(normalizeRepository);
    expect(repositories.every((repository) => repository !== null)).toBe(true);
    const first = repositories[0];
    expect(first?.fullName).toContain("octocat/");
    expect(first?.fork).toBeTypeOf("boolean");
    expect(first?.archived).toBeTypeOf("boolean");
    expect(first?.isTemplate).toBeTypeOf("boolean");
    expect(first?.mirror).toBe(false);
    expect(first?.defaultBranch).not.toBe("");
    expect(first?.sizeKb).toBeGreaterThanOrEqual(0);
  });

  it("reads a real recursive tree with blob sizes", () => {
    const tree = normalizeTree(recorded("tree"));
    expect(tree.truncated).toBe(false);
    expect(tree.entries.length).toBeGreaterThan(0);
    expect(tree.entries.every((entry) => entry.path !== "")).toBe(true);
    expect(tree.entries.some((entry) => entry.type === "blob" && entry.sizeBytes > 0)).toBe(true);
  });

  it("bounds an oversized tree", () => {
    const huge = {
      truncated: false,
      tree: Array.from({ length: MAX_TREE_ENTRIES + 500 }, (_value, index) => ({
        path: `src/file-${String(index)}.ts`,
        type: "blob",
        size: 10,
      })),
    };
    const tree = normalizeTree(huge);
    expect(tree.entries).toHaveLength(MAX_TREE_ENTRIES);
    expect(tree.truncated).toBe(true);
  });

  it("reads real languages and an empty release list", () => {
    expect(Object.keys(normalizeLanguages(recorded("languages"))).length).toBeGreaterThan(0);
    expect(normalizeReleases(recorded("releases"))).toEqual({ count: 0, latestAt: null });
  });

  it("reads real public events, which carry no commit payload", () => {
    const raw = recorded("events") as unknown[];
    const events = raw.map(normalizeEvent);
    expect(events.every((event) => event !== null)).toBe(true);
    const push = events.find((event) => event?.type === "PushEvent");
    expect(push?.repoFullName).toContain("/");
    expect(push?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The finding ADR 0004 D3 is written against.
    expect(Object.keys((raw[0] as { payload: object }).payload)).not.toContain("commits");
  });

  it("reads real commits, with merges identified by parent count", () => {
    const commits = normalizeCommits(recorded("commits"));
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every((commit) => commit.message !== "")).toBe(true);
    expect(commits.every((commit) => commit.authoredAt !== "")).toBe(true);
    expect(commits.some((commit) => commit.parentCount > 1)).toBe(true);
    expect(commits.every((commit) => commit.isBotAuthor === false)).toBe(true);
  });

  it("survives malformed input without throwing", () => {
    expect(normalizeProfile(null)).toBeNull();
    expect(normalizeProfile({})).toBeNull();
    expect(normalizeRepository({ name: "" })).toBeNull();
    expect(normalizeEvent({ type: "PushEvent" })).toBeNull();
    expect(normalizeTree("nonsense")).toEqual({ sha: "", entries: [], truncated: false });
    expect(normalizeCommits({ not: "an array" })).toEqual([]);
    expect(normalizeLanguages(42)).toEqual({});
  });

  it.each([
    ["dependabot[bot]", true],
    ["renovate", true],
    ["github-actions", true],
    ["release-bot", true],
    ["octocat", false],
    ["robotics-lab", false],
  ])("classifies %s as a bot: %s", (name, expected) => {
    expect(isBotName(name)).toBe(expected);
  });
});
