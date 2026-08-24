declare const usernameBrand: unique symbol;

/** A value that has passed GitHub's documented username rules. */
export type GithubUsername = string & { readonly [usernameBrand]: "GithubUsername" };

export const GITHUB_USERNAME_MAX_LENGTH = 39;

/** 1–39 characters, alphanumeric or hyphen, no leading or trailing hyphen, no
 * consecutive hyphens. */
const USERNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export function parseGithubUsername(value: string): GithubUsername | null {
  return USERNAME_PATTERN.test(value) ? (value as GithubUsername) : null;
}

/**
 * Normalizes the three friend-facing identity forms accepted by the CLI without
 * broadening GitHub's username grammar. Padding, encoded paths, credentials and
 * every non-profile URL are refused locally before cache or network access.
 */
export function normalizeGithubLogin(value: string): GithubUsername | null {
  const containsControl = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (value === "" || value !== value.trim() || containsControl) return null;

  if (value.startsWith("@")) {
    if (value.indexOf("@", 1) !== -1) return null;
    return parseGithubUsername(value.slice(1));
  }

  if (!value.includes("://")) return parseGithubUsername(value);
  if (value.includes("%")) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  const match = /^\/([^/]+)\/?$/.exec(url.pathname);
  return match?.[1] === undefined ? null : parseGithubUsername(match[1]);
}

export function isGithubUsername(value: string): value is GithubUsername {
  return parseGithubUsername(value) !== null;
}
