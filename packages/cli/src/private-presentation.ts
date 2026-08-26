import { formatCount, type PrivateContextResult } from "@gitmog/private-context";

export const privateQualitySampleText = (result: PrivateContextResult): string => {
  const readable = result.maintainedCodebase.files;
  const sampled = result.maintainedCodebase.sampledFiles;
  if (sampled === 0) return "Code sample: no readable TypeScript/JavaScript files.";
  if (readable === sampled)
    return `Code sample: ${formatCount(sampled, "file")} · all ${String(sampled)} readable by Git Mog`;
  return `Code sample: ${String(readable)} of ${formatCount(sampled, "file")} readable by Git Mog`;
};

export const selectedPrivateRepositoryText = (
  result: PrivateContextResult,
  modifier = "selected private",
): string => formatCount(result.repositorySelection.analyzedRepositories, "repo", modifier);

export const privateRelationshipText = (result: PrivateContextResult): string => {
  switch (result.relationship) {
    case "maintained-and-attributed":
    case "attributed-only":
      return "codebase read · authorship matched";
    case "maintained-only":
      return "codebase read · authorship not established";
    case "insufficient":
      return "not enough readable code · authorship not established";
    default:
      return "no qualifying repo";
  }
};
