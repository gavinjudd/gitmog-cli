import { describe, expect, it } from "vitest";

import {
  GITHUB_USERNAME_MAX_LENGTH,
  normalizeGithubLogin,
  parseGithubUsername,
} from "../src/username.js";

describe("parseGithubUsername", () => {
  it.each(["octocat", "a", "a-b", "gitmog-bot", "A1", "1a"])("accepts %s", (value) => {
    expect(parseGithubUsername(value)).toBe(value);
  });

  it("accepts the maximum length and rejects one character more", () => {
    const maximum = "a".repeat(GITHUB_USERNAME_MAX_LENGTH);
    expect(parseGithubUsername(maximum)).toBe(maximum);
    expect(parseGithubUsername(`${maximum}a`)).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["leading hyphen", "-octocat"],
    ["trailing hyphen", "octocat-"],
    ["consecutive hyphens", "octo--cat"],
    ["underscore", "octo_cat"],
    ["dot", "octo.cat"],
    ["space", "octo cat"],
    ["slash", "octo/cat"],
  ])("rejects %s", (_reason, value) => {
    expect(parseGithubUsername(value)).toBeNull();
  });
});

describe("normalizeGithubLogin", () => {
  it.each([
    ["torvalds", "torvalds"],
    ["@torvalds", "torvalds"],
    ["https://github.com/torvalds", "torvalds"],
    ["https://github.com/torvalds/", "torvalds"],
  ])("normalizes %s", (value, expected) => {
    expect(normalizeGithubLogin(value)).toBe(expected);
  });

  it.each([
    " torvalds",
    "torvalds ",
    "https://github.com/torvalds/linux",
    "https://github.com/torvalds/issues/1",
    "https://gist.github.com/torvalds/abc",
    "https://github.example/torvalds",
    "https://github.com.example/torvalds",
    "https://user:password@github.com/torvalds",
    "https://github.com/%74orvalds",
    "https://github.com/torvalds?tab=repositories",
    "https://github.com/torvalds#readme",
    "https://github.com//torvalds",
    "@",
    "@torvalds@github",
    "tor\u0000valds",
  ])("rejects %s", (value) => {
    expect(normalizeGithubLogin(value)).toBeNull();
  });
});
