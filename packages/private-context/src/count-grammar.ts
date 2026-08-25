export type CountNoun =
  "assertion" | "file" | "project" | "repo" | "repository" | "request" | "test";
export type CountVerb = "contains" | "has" | "shows" | "was";

const NOUN_FORMS: Readonly<Record<CountNoun, readonly [singular: string, plural: string]>> =
  Object.freeze({
    assertion: ["assertion", "assertions"],
    file: ["file", "files"],
    project: ["project", "projects"],
    repo: ["repo", "repos"],
    repository: ["repository", "repositories"],
    request: ["request", "requests"],
    test: ["test", "tests"],
  });

const VERB_FORMS: Readonly<Record<CountVerb, readonly [singular: string, plural: string]>> =
  Object.freeze({
    contains: ["contains", "contain"],
    has: ["has", "have"],
    shows: ["shows", "show"],
    was: ["was", "were"],
  });

const validateCount = (count: number): void => {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError("Count grammar requires a non-negative safe integer.");
  }
};

export function countNoun(count: number, noun: CountNoun): string {
  validateCount(count);
  return NOUN_FORMS[noun][count === 1 ? 0 : 1];
}

export function countVerb(count: number, verb: CountVerb): string {
  validateCount(count);
  return VERB_FORMS[verb][count === 1 ? 0 : 1];
}

export function formatCount(count: number, noun: CountNoun, modifier = ""): string {
  validateCount(count);
  const prefix = modifier.trim();
  return `${String(count)}${prefix === "" ? "" : ` ${prefix}`} ${countNoun(count, noun)}`;
}
