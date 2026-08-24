const useColor = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

const paint = (code, text) => (useColor ? `\u001B[${code}m${text}\u001B[0m` : text);

export const style = {
  bold: (text) => paint("1", text),
  dim: (text) => paint("2", text),
  green: (text) => paint("32", text),
  yellow: (text) => paint("33", text),
  red: (text) => paint("31", text),
  cyan: (text) => paint("36", text),
};

export function heading(text) {
  console.log(`\n${style.bold(text)}`);
}

export function info(text) {
  console.log(text);
}

export function step(text) {
  console.log(`${style.cyan("›")} ${text}`);
}

export function ok(text) {
  console.log(`${style.green("✔")} ${text}`);
}

export function warn(text) {
  console.warn(`${style.yellow("!")} ${text}`);
}

export function fail(text) {
  console.error(`${style.red("✖")} ${text}`);
}

const STATUS_STYLE = {
  PASS: style.green,
  WARN: style.yellow,
  FAIL: style.red,
  INFO: style.dim,
};

export function checkLine(status, label, detail) {
  const painter = STATUS_STYLE[status] ?? style.dim;
  const suffix = detail === undefined || detail === "" ? "" : `  ${style.dim(detail)}`;
  console.log(`${painter(status.padEnd(4))} ${label}${suffix}`);
}
