import { rmSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

const targetArgument = process.argv[2];
if (targetArgument === undefined) throw new Error("Expected one build-output directory.");

const packageDirectory = resolve(process.cwd());
const target = resolve(packageDirectory, targetArgument);
const relativeTarget = relative(packageDirectory, target);
if (
  basename(target) !== "dist" ||
  relativeTarget === "" ||
  relativeTarget === ".." ||
  relativeTarget.startsWith(`..${sep}`) ||
  isAbsolute(relativeTarget)
) {
  throw new Error(`Refusing to remove unexpected build output: ${target}`);
}

rmSync(target, { recursive: true, force: true });
