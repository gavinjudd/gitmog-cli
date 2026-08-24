export function deeplyNested(values: readonly boolean[]): number {
  if (values[0]) {
    if (values[1]) {
      if (values[2]) {
        if (values[3]) {
          if (values[4]) return 5;
        }
      }
    }
  }
  return 0;
}
