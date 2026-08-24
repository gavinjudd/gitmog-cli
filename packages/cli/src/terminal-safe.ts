/**
 * Makes untrusted GitHub text inert on every human text surface.
 *
 * C0/C1 controls are rendered as compact visible escapes. In particular, ESC can no
 * longer begin CSI, OSC, DCS, or terminal-hyperlink sequences, and CR/LF cannot create
 * attacker-controlled rows. Printable Unicode is preserved exactly.
 */
export function terminalSafe(value: string): string {
  let safe = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (!((code >= 0 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f))) {
      safe += character;
      continue;
    }
    if (character === "\n") safe += "\\n";
    else if (character === "\r") safe += "\\r";
    else if (character === "\t") safe += "\\t";
    else if (character === "\b") safe += "\\b";
    else safe += `\\x${code.toString(16).padStart(2, "0")}`;
  }
  return safe;
}
