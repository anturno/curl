export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function repoPath(owner: string, repo: string): string {
  return `/repos/${owner}/${repo}`;
}
