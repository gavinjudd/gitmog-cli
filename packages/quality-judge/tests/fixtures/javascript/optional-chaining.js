export function getOwnerName(record) {
  return record?.owner?.profile?.name ?? "unknown";
}

export function getFirstItem(items) {
  return items?.[0]?.value ?? null;
}
