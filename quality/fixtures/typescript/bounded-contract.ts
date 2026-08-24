export interface WindowInput {
  readonly start: number;
  readonly end: number;
}

export function boundedWidth(input: WindowInput): number {
  if (!Number.isFinite(input.start) || !Number.isFinite(input.end)) {
    throw new TypeError("window bounds must be finite");
  }
  if (input.end < input.start) throw new RangeError("window end precedes start");
  return input.end - input.start;
}
