import { describe, expect, it } from "vitest";

import { visibleWidth } from "../src/render.js";
import { compactSupportLine, type ClaimSupportReceipt } from "../src/support.js";
import { terminalSafe } from "../src/terminal-safe.js";

describe("terminal-safe untrusted text", () => {
  it("visibly escapes newline, CRLF, CSI, OSC, bell, backspace, and every C0/C1 code", () => {
    const allControls = [
      ...Array.from({ length: 0x20 }, (_value, code) => String.fromCodePoint(code)),
      ...Array.from({ length: 0x21 }, (_value, offset) => String.fromCodePoint(0x7f + offset)),
    ].join("");
    const input = `src/混合\nline\r\n\u001b[2J\u001b[4A\u001b]2;title\u0007\u001b]8;;https://evil.example\u0007link\u001b]8;;\u0007bell\u0008${allControls}.ts`;
    const first = terminalSafe(input);
    expect(terminalSafe(input)).toBe(first);
    expect(first).toContain("src/混合\\nline\\r\\n\\x1b[2J");
    expect(first).toContain("\\x1b]2;title\\x07");
    expect(first).toContain("\\x1b]8;;https://evil.example\\x07link");
    expect(first).toContain("\\x07bell\\b");
    expect(
      [...first].every((character) => {
        const code = character.codePointAt(0) ?? 0;
        return !((code >= 0 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f));
      }),
    ).toBe(true);
    expect(first).not.toContain("\u001b[");
    expect(first).not.toContain("\u001b]");
  });

  it("applies character limits after controls become visible escapes", () => {
    const receipt: ClaimSupportReceipt = {
      key: "left:sample:safe",
      id: "safe",
      side: "left",
      kind: "sample",
      label: "Code sample",
      reference: "example/repo",
      compactText: terminalSafe(`src/${"界".repeat(80)}\u001b[2J.ts`),
      sourceUrl: "https://github.com/example/repo",
    };
    const compact = compactSupportLine(receipt, 48);
    expect(visibleWidth(compact)).toBeLessThanOrEqual(48);
    expect(compact).not.toContain("\u001b[2J");
    expect(compact).toContain("…");
  });
});
