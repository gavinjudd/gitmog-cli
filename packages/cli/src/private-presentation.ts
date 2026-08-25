import { formatCount, type PrivateContextResult } from "@gitmog/private-context";

export const privateQualitySampleText = (result: PrivateContextResult): string =>
  `Code-quality sample: ${formatCount(result.maintainedCodebase.repositories, "repo")} · ${formatCount(result.maintainedCodebase.files, "file", "parsed")} · ${String(result.maintainedCodebase.coverage)}% supported coverage`;

export const selectedPrivateRepositoryText = (
  result: PrivateContextResult,
  modifier = "selected private",
): string => formatCount(result.repositorySelection.analyzedRepositories, "repo", modifier);
