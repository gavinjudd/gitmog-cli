import { describe, expect, it } from "vitest";

import { MAX_REDACTED_SHARE, REDACTION_TOKEN, redactSecretShapedValues } from "../src/redaction.js";

describe("secret-shaped-value redaction", () => {
  it.each([
    ["GitHub token", "const token = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';"],
    ["GitHub fine-grained token", "const token = 'github_pat_1234567890abcdefghijklmnop';"],
    ["OpenAI-shaped key", "const apiKey = 'sk-1234567890abcdefghijklmnopqrstuv';"],
    ["AWS access key", "const access = 'AKIAABCDEFGHIJKLMNOP';"],
    ["Google key", "const key = 'AIza1234567890abcdefghijABCDEFGHIJKLM';"],
    ["Slack token", "const slack = 'xoxb-1234567890-abcdefghij';"],
    ["GitLab token", "const token = 'glpat-1234567890abcdefghijkl';"],
    ["npm token", "const token = 'npm_1234567890abcdefghijklmnopqrstuvwxyz';"],
    ["JWT", "const jwt = 'eyJabcdefghijk.eyJabcdefghijklmnop.signature12345';"],
  ])("redacts a %s", (_name, source) => {
    const result = redactSecretShapedValues(source);
    expect(result.redactions).toBeGreaterThan(0);
    expect(result.text).toContain(REDACTION_TOKEN);
    expect(result.text).not.toBe(source);
  });

  it("redacts any quoted assignment to a secret-shaped identifier", () => {
    const result = redactSecretShapedValues(
      [
        'password = "ordinary looking phrase";',
        "client_secret: 'also ordinary';",
        "SESSION_KEY = `short-but-named`;",
      ].join("\n"),
    );
    expect(result.redactions).toBe(3);
    expect(result.text).not.toContain("ordinary looking phrase");
    expect(result.text).not.toContain("also ordinary");
    expect(result.text).not.toContain("short-but-named");
  });

  it("redacts private-key blocks and preserves their newline count", () => {
    const source = [
      "const before = true;",
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEA7q4L5pQG",
      "more-key-material",
      "-----END RSA PRIVATE KEY-----",
      "const after = true;",
    ].join("\n");
    const result = redactSecretShapedValues(source);
    expect(result.redactions).toBe(1);
    expect(result.text).not.toContain("MIIEow");
    expect(result.text.split("\n")).toHaveLength(source.split("\n").length);
  });

  it("redacts a long, high-entropy quoted string even beside an ordinary name", () => {
    const value = "aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5z";
    const result = redactSecretShapedValues(`const value = "${value}";`);
    expect(result.redactions).toBe(1);
    expect(result.text).not.toContain(value);
  });

  it("does not redact normal source, URLs, prose or short constants", () => {
    const source = [
      'const greeting = "hello, world";',
      'const url = "https://github.com/gitmog/gitmog";',
      'const id = "abcdefghijkl";',
      'throw new Error("authentication failed");',
    ].join("\n");
    expect(redactSecretShapedValues(source)).toEqual({
      text: source,
      redactions: 0,
      redactedBytes: 0,
      exhausted: false,
    });
  });

  it("marks a sample exhausted when redaction removes a material share", () => {
    const key = [
      "-----BEGIN PRIVATE KEY-----",
      "a".repeat(2_000),
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const result = redactSecretShapedValues(`${key}\nconst x = 1;`);
    expect(result.redactedBytes / key.length).toBeGreaterThan(MAX_REDACTED_SHARE);
    expect(result.exhausted).toBe(true);
  });

  it("is deterministic and never returns the original secret", () => {
    const secret = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const first = redactSecretShapedValues(`token = "${secret}";`);
    const second = redactSecretShapedValues(`token = "${secret}";`);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain(secret);
  });
});
