import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export const BROWSER_CAPABILITY_VERSION = "1.0.0-closed-github-destinations";

const GITHUB_ORIGIN = "https://github.com";
const GITHUB_DEVICE_URL = `${GITHUB_ORIGIN}/login/device`;
const PRIVATE_APP_INSTALL_URL = `${GITHUB_ORIGIN}/apps/git-mog-private-context/installations/new`;
const PRIVATE_SETTINGS_PATH = /^\/settings\/installations\/[1-9]\d{0,19}$/u;

export type ExternalDestination =
  | { readonly kind: "github-device"; readonly url: string }
  | { readonly kind: "private-app-install"; readonly url: string }
  | { readonly kind: "private-app-settings"; readonly url: string };

declare const validatedDestination: unique symbol;
export type ValidatedExternalDestination = ExternalDestination & {
  readonly [validatedDestination]: true;
};

export type OpenExternalResult =
  | { readonly status: "opened" }
  | { readonly status: "unsupported" }
  | { readonly status: "failed" };

export interface ExternalCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

const browserProcessEnvironment = (
  platform: NodeJS.Platform,
  source: Readonly<NodeJS.ProcessEnv>,
): NodeJS.ProcessEnv => {
  const allowed =
    platform === "linux"
      ? [
          "DBUS_SESSION_BUS_ADDRESS",
          "DISPLAY",
          "LANG",
          "LC_ALL",
          "PATH",
          "WAYLAND_DISPLAY",
          "XDG_CURRENT_DESKTOP",
          "XDG_RUNTIME_DIR",
          "XDG_SESSION_TYPE",
        ]
      : platform === "win32"
        ? ["LANG", "PATH", "SYSTEMROOT", "WINDIR"]
        : ["LANG", "LC_ALL", "PATH"];
  return Object.fromEntries(
    allowed.flatMap((name) => {
      const value = source[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
};

const exactGithubUrl = (value: string): URL | null => {
  if (/[^\u0020-\u007e]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      url.origin !== GITHUB_ORIGIN ||
      url.href !== value
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
};

export function validateExternalDestination(
  destination: ExternalDestination,
): ValidatedExternalDestination | null {
  const url = exactGithubUrl(destination.url);
  if (url === null) return null;
  const valid =
    destination.kind === "github-device"
      ? url.href === GITHUB_DEVICE_URL && url.pathname === "/login/device" && url.search === ""
      : destination.kind === "private-app-install"
        ? url.href === PRIVATE_APP_INSTALL_URL &&
          url.pathname === "/apps/git-mog-private-context/installations/new" &&
          url.search === ""
        : PRIVATE_SETTINGS_PATH.test(url.pathname) && url.search === "";
  return valid ? (destination as ValidatedExternalDestination) : null;
}

export const githubDeviceDestination = (): ValidatedExternalDestination =>
  validateExternalDestination({
    kind: "github-device",
    url: GITHUB_DEVICE_URL,
  }) as ValidatedExternalDestination;

export const privateAppInstallationDestination = (): ValidatedExternalDestination =>
  validateExternalDestination({
    kind: "private-app-install",
    url: PRIVATE_APP_INSTALL_URL,
  }) as ValidatedExternalDestination;

export const privateAppSettingsDestination = (url: string): ValidatedExternalDestination | null =>
  validateExternalDestination({ kind: "private-app-settings", url });

export function externalCommandFor(
  destination: ValidatedExternalDestination,
  platform: NodeJS.Platform,
  fileExists: (path: string) => boolean = existsSync,
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): ExternalCommand | null {
  const validated = validateExternalDestination(destination);
  if (validated === null) return null;
  if (platform === "darwin") {
    return { executable: "/usr/bin/open", args: [validated.url] };
  }
  if (platform === "win32") {
    return {
      executable: "C:\\Windows\\System32\\rundll32.exe",
      args: ["url.dll,FileProtocolHandler", validated.url],
    };
  }
  if (
    platform === "linux" &&
    fileExists("/usr/bin/xdg-open") &&
    (environment.DISPLAY !== undefined || environment.WAYLAND_DISPLAY !== undefined)
  ) {
    return { executable: "/usr/bin/xdg-open", args: [validated.url] };
  }
  return null;
}

export async function openExternal(
  destination: ValidatedExternalDestination,
): Promise<OpenExternalResult> {
  const command = externalCommandFor(destination, process.platform);
  if (command === null) return { status: "unsupported" };
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => finish({ status: "failed" }), 450);
    timeout.unref();
    const finish = (result: OpenExternalResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    try {
      const child = spawn(command.executable, [...command.args], {
        cwd: process.platform === "win32" ? "C:\\Windows\\System32" : "/",
        detached: true,
        env: browserProcessEnvironment(process.platform, process.env),
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      });
      child.once("error", () => finish({ status: "failed" }));
      child.once("spawn", () => {
        child.unref();
        finish({ status: "opened" });
      });
    } catch {
      finish({ status: "failed" });
    }
  });
}
