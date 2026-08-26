import { describe, expect, it } from "vitest";

import {
  externalCommandFor,
  githubDeviceDestination,
  privateAppInstallationDestination,
  privateAppSettingsDestination,
  validateExternalDestination,
  type ExternalDestination,
  type ValidatedExternalDestination,
} from "../src/open-external.js";

const validate = (kind: ExternalDestination["kind"], url: string) =>
  validateExternalDestination({ kind, url });

describe("external destination validation", () => {
  it("accepts only the reviewed GitHub device destination", () => {
    expect(githubDeviceDestination()).toEqual({
      kind: "github-device",
      url: "https://github.com/login/device",
    });
    for (const value of [
      "http://github.com/login/device",
      "https://github.com.evil.example/login/device",
      "https://github.example/login/device",
      "https://user:pass@github.com/login/device",
      "https://github.com:443/login/device",
      "https://github.com/login/device#fragment",
      "https://github.com/login/device?next=/settings",
      "https://github.com/login/%2e%2e/settings",
      "https://github.com/login/device\n",
      "https://github.com/login/device\r",
      'https://github.com/login/device"',
      "https://github.com/login/device&open=1",
      "https://github.com/login/device;open=1",
      "https://github.com/login/device|open",
      "https://github.com/login/device$(open)",
      "https://githuЬ.com/login/device",
      "file:///etc/passwd",
      "https://localhost/login/device",
      "https://github.com/private-owner/private-repository",
      "strongmaintainer",
    ]) {
      expect(validate("github-device", value), value).toBeNull();
    }
  });

  it("accepts only the reviewed Private Context app and settings paths", () => {
    expect(privateAppInstallationDestination()).toEqual({
      kind: "private-app-install",
      url: "https://github.com/apps/git-mog-private-context/installations/new",
    });
    expect(
      privateAppSettingsDestination("https://github.com/settings/installations/12345"),
    ).toEqual({
      kind: "private-app-settings",
      url: "https://github.com/settings/installations/12345",
    });
    for (const value of [
      "https://github.com/apps/another-app/installations/new",
      "https://github.com/apps/git-mog-private-context/installations/new?target_id=1",
      "https://github.com/apps/git-mog-private-context",
      "https://github.com/settings/installations/0",
      "https://github.com/settings/installations/not-an-id",
      "https://github.com/settings/installations/12345?tab=repositories",
      "https://github.com/settings/installations/12345#repositories",
      "https://github.com/settings/installations/12345/extra",
      "https://github.com/private-owner/private-repository/settings",
    ]) {
      expect(
        value.includes("/apps/")
          ? validate("private-app-install", value)
          : validate("private-app-settings", value),
        value,
      ).toBeNull();
    }
  });
});

describe("cross-platform command mapping", () => {
  const destination = githubDeviceDestination();

  it("uses the exact macOS system opener with a separate URL argument", () => {
    expect(externalCommandFor(destination, "darwin")).toEqual({
      executable: "/usr/bin/open",
      args: ["https://github.com/login/device"],
    });
  });

  it("uses native Windows rundll32 without a shell or interpolation", () => {
    expect(externalCommandFor(destination, "win32")).toEqual({
      executable: "C:\\Windows\\System32\\rundll32.exe",
      args: ["url.dll,FileProtocolHandler", "https://github.com/login/device"],
    });
  });

  it("uses exact xdg-open only when it is present", () => {
    expect(externalCommandFor(destination, "linux", () => true, { DISPLAY: ":0" })).toEqual({
      executable: "/usr/bin/xdg-open",
      args: ["https://github.com/login/device"],
    });
    expect(externalCommandFor(destination, "linux", () => false, { DISPLAY: ":0" })).toBeNull();
    expect(externalCommandFor(destination, "linux", () => true, {})).toBeNull();
    expect(externalCommandFor(destination, "freebsd", () => true, {})).toBeNull();
  });

  it("revalidates branded-looking input before command construction", () => {
    const forged = {
      kind: "github-device",
      url: "https://github.com/private-owner/private-repository",
    } as ValidatedExternalDestination;
    expect(externalCommandFor(forged, "darwin")).toBeNull();
  });

  it("never places codes, tokens, handles, or repository data in arguments", () => {
    for (const approved of [
      githubDeviceDestination(),
      privateAppInstallationDestination(),
      privateAppSettingsDestination("https://github.com/settings/installations/12345"),
    ]) {
      if (approved === null) throw new Error("Fixture destination was rejected.");
      const command = externalCommandFor(approved, "win32");
      const serialized = JSON.stringify(command);
      expect(serialized).not.toContain("ABCD-EFGH");
      expect(serialized).not.toContain("synthetic_token");
      expect(serialized).not.toContain("strongmaintainer");
      expect(serialized).not.toContain("private-owner");
    }
  });
});
