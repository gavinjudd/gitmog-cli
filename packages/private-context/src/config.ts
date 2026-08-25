import type { PrivateContextAppConfig } from "./types.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).toSorted();
  return (
    actual.length === keys.length && actual.every((key, index) => key === keys.toSorted()[index])
  );
};

export type PrivateContextConfigValidation =
  | { readonly ok: true; readonly config: PrivateContextAppConfig }
  | { readonly ok: false; readonly error: string };

export function validatePrivateContextAppConfig(value: unknown): PrivateContextConfigValidation {
  const keys = [
    "appId",
    "clientId",
    "clientSecrets",
    "deviceFlow",
    "installationSelectionRequired",
    "name",
    "permissions",
    "privateKeys",
    "slug",
    "version",
  ] as const;
  if (!isRecord(value) || !exactKeys(value, keys)) {
    return { ok: false, error: "Private Context app configuration has unknown or missing fields." };
  }
  if (value.version !== "1.0.0")
    return { ok: false, error: "Private Context app configuration version is invalid." };
  if (value.name !== "Git Mog Private Context" && value.name !== "Git Mog Private Context CLI")
    return { ok: false, error: "Private Context app name is invalid." };
  if (typeof value.slug !== "string" || !/^git-mog-private-context(?:-cli)?$/u.test(value.slug))
    return { ok: false, error: "Private Context app slug is invalid." };
  if (typeof value.appId !== "string" || !/^[1-9]\d{3,15}$/u.test(value.appId))
    return { ok: false, error: "Private Context app ID is invalid." };
  if (typeof value.clientId !== "string" || !/^Iv[0-9A-Za-z]{18,126}$/u.test(value.clientId))
    return { ok: false, error: "Private Context client ID is invalid." };
  if (value.deviceFlow !== true)
    return { ok: false, error: "Private Context device flow must be enabled." };
  if (value.installationSelectionRequired !== "selected")
    return { ok: false, error: "Private Context must require selected repositories." };
  if (value.privateKeys !== 0 || value.clientSecrets !== 0)
    return { ok: false, error: "Private Context cannot contain a private key or client secret." };
  if (!isRecord(value.permissions) || !exactKeys(value.permissions, ["contents", "metadata"]))
    return {
      ok: false,
      error: "Private Context permissions must be exactly metadata and contents.",
    };
  if (value.permissions.metadata !== "read" || value.permissions.contents !== "read")
    return { ok: false, error: "Private Context permissions must be read-only." };
  return { ok: true, config: value as unknown as PrivateContextAppConfig };
}

export const privateContextInstallationUrl = (config: PrivateContextAppConfig): string =>
  `https://github.com/apps/${config.slug}/installations/new`;
