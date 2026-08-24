export function select(values) {
  if (!Array.isArray(values)) throw new TypeError("values");
  return values.filter((value) => value !== null);
}
