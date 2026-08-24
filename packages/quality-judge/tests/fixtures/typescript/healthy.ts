export function parsePort(value: unknown): number {
  if (typeof value !== "number") throw new TypeError("port");
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new RangeError("port");
  return value;
}

export async function closeResource(resource: { close(): Promise<void> }): Promise<void> {
  try {
    await resource.close();
  } catch (error: unknown) {
    throw new Error("close failed", { cause: error });
  }
}
