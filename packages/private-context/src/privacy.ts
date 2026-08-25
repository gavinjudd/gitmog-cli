const SECRET_SHAPE =
  /(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----)/u;
const PRIVATE_FIELD =
  /"(?:repository|repositoryId|installationId|path|sourceUrl|commitSha|blobSha|commitMessage|source)"\s*:/iu;

export interface PrivateArtifactScanner {
  readonly scan: (value: string) => boolean;
  readonly dispose: () => void;
}

export function createPrivateArtifactScanner(values: readonly string[]): PrivateArtifactScanner {
  const forbidden = new Set(
    values.map((value) => value.normalize("NFC")).filter((value) => value.length >= 4),
  );
  return {
    scan: (value) => {
      const normalized = value.normalize("NFC");
      if (SECRET_SHAPE.test(normalized) || PRIVATE_FIELD.test(normalized)) return false;
      for (const candidate of forbidden) if (normalized.includes(candidate)) return false;
      return true;
    },
    dispose: () => forbidden.clear(),
  };
}

export function privateAggregateShapeIsSafe(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  return !SECRET_SHAPE.test(serialized) && !PRIVATE_FIELD.test(serialized);
}

/** Defense in depth for JSON, HTML, and SVG surfaces. Collection remains the
 * authoritative value-aware scan; this rejects private-shaped fields or secret
 * material introduced while rendering the already-safe aggregate result. */
export function mixedPrivateArtifactIsSafe(value: string, result: unknown): boolean {
  return privateAggregateShapeIsSafe(result) && !SECRET_SHAPE.test(value.normalize("NFC"));
}
