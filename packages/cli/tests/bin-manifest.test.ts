import { accessSync, constants, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  readonly bin: Readonly<Record<string, string>>;
};

describe("CLI bin manifest", () => {
  it("points both command names at a committed pre-build launcher", () => {
    expect(manifest.bin).toEqual({
      gitmog: "./bin/gitmog.mjs",
      "git-mog": "./bin/gitmog.mjs",
    });
    const launcher = join(packageRoot, manifest.bin.gitmog as string);
    expect(() => readFileSync(launcher, "utf8")).not.toThrow();
    expect(() => accessSync(launcher, constants.X_OK)).not.toThrow();
  });
});
