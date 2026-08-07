import type { GitHubChannelState } from "eve/channels/github";
import {
  type ChangedFile,
  type CheckEvidence,
  DEFAULT_REVIEW_POLICY,
  parsePolicyDocument,
  type ReviewContext,
  type ReviewPolicy,
} from "./review-contract";

export const REVIEW_POLICY_PATH = ".curl/review-policy.json";
const MAX_CHANGED_FILES = 1_000;
const MAX_CONTEXT_FILES = 300;

export interface ReviewGitHubReader {
  request(input: {
    readonly method: "GET";
    readonly path: string;
  }): Promise<{ readonly body: unknown }>;
}

export type ReviewContextState = Pick<
  GitHubChannelState,
  "baseSha" | "headSha" | "owner" | "pullRequestNumber" | "repo"
>;

export interface ReviewContextSource {
  readonly github: ReviewGitHubReader;
  readonly state: ReviewContextState;
}

export async function loadReviewContext(source: ReviewContextSource): Promise<ReviewContext> {
  const pullRequestNumber = source.state.pullRequestNumber;
  if (pullRequestNumber === null) {
    return {
      changedFiles: [],
      policy: DEFAULT_REVIEW_POLICY,
      policyStatus: "missing",
    };
  }

  const repository = repositoryPath(source.state.owner, source.state.repo);
  const pullRequest = await requestRecord(
    source.github,
    `/repos/${repository}/pulls/${pullRequestNumber}`,
  );
  const baseSha = source.state.baseSha ?? readNestedString(pullRequest, "base", "sha");
  const headSha = source.state.headSha ?? readNestedString(pullRequest, "head", "sha");
  if (!baseSha || !headSha) {
    return {
      changedFiles: [],
      policy: DEFAULT_REVIEW_POLICY,
      policyStatus: "missing",
    };
  }

  const [changedFiles, policyResult, checks] = await Promise.all([
    loadChangedFiles(source.github, repository, baseSha, headSha),
    loadPolicy(source.github, repository, baseSha),
    loadChecks(source.github, repository, headSha),
  ]);

  return {
    changedFiles,
    checks,
    policy: policyResult.policy,
    policyStatus: policyResult.status,
  };
}

export function buildReviewContextMessage(context: ReviewContext): string {
  const payload = {
    changedFiles: context.changedFiles.slice(0, MAX_CONTEXT_FILES).map((file) => ({
      path: file.path,
      changedLines: file.changedLines,
    })),
    policy: context.policy,
    policyStatus: context.policyStatus ?? "valid",
  };
  return `<curl_review_context>\n${JSON.stringify(payload)}\n</curl_review_context>`;
}

async function loadChangedFiles(
  github: ReviewGitHubReader,
  repository: string,
  baseSha: string,
  headSha: string,
): Promise<readonly ChangedFile[]> {
  const body = await requestUnknown(
    github,
    `/repos/${repository}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`,
  );
  if (!isRecord(body) || !Array.isArray(body.files)) {
    return [];
  }
  return body.files.slice(0, MAX_CHANGED_FILES).flatMap((item): ChangedFile[] => {
    if (!isRecord(item) || typeof item.filename !== "string") {
      return [];
    }
    return [
      {
        path: item.filename,
        changedLines: parseChangedLines(typeof item.patch === "string" ? item.patch : ""),
      },
    ];
  });
}

async function loadPolicy(
  github: ReviewGitHubReader,
  repository: string,
  baseSha: string,
): Promise<{ readonly policy: ReviewPolicy; readonly status: "invalid" | "missing" | "valid" }> {
  try {
    const body = await requestUnknown(
      github,
      `/repos/${repository}/contents/${REVIEW_POLICY_PATH}?ref=${encodeURIComponent(baseSha)}`,
    );
    if (!isRecord(body) || typeof body.content !== "string") {
      return { policy: DEFAULT_REVIEW_POLICY, status: "invalid" };
    }
    if (body.content.length > 100_000) {
      return { policy: DEFAULT_REVIEW_POLICY, status: "invalid" };
    }
    const text = Buffer.from(body.content.replace(/\s+/gu, ""), "base64").toString("utf8");
    const policy = parsePolicyDocument(text);
    return policy
      ? { policy, status: "valid" }
      : { policy: DEFAULT_REVIEW_POLICY, status: "invalid" };
  } catch (error) {
    if (isNotFound(error)) {
      return { policy: DEFAULT_REVIEW_POLICY, status: "missing" };
    }
    return { policy: DEFAULT_REVIEW_POLICY, status: "invalid" };
  }
}

async function loadChecks(
  github: ReviewGitHubReader,
  repository: string,
  headSha: string,
): Promise<readonly CheckEvidence[]> {
  const checks = new Map<string, CheckEvidence["status"][]>();
  for (let page = 1; page <= 10; page += 1) {
    let body: unknown;
    try {
      body = await requestUnknown(
        github,
        `/repos/${repository}/commits/${encodeURIComponent(headSha)}/check-runs?per_page=100&page=${page}`,
      );
    } catch {
      return [];
    }
    if (!isRecord(body) || !Array.isArray(body.check_runs)) {
      return [];
    }
    for (const item of body.check_runs) {
      if (isRecord(item) && typeof item.name === "string" && item.head_sha === headSha) {
        const statuses = checks.get(item.name) ?? [];
        statuses.push(checkStatus(item.conclusion));
        checks.set(item.name, statuses);
      }
    }
    if (body.check_runs.length < 100) {
      break;
    }
  }
  return [...checks].map(([name, statuses]) => ({
    name,
    status: statuses.length === 1 ? statuses[0] : "unknown",
  }));
}

async function requestRecord(
  github: ReviewGitHubReader,
  path: string,
): Promise<Record<string, unknown>> {
  const body = await requestUnknown(github, path);
  return isRecord(body) ? body : {};
}

async function requestUnknown(github: ReviewGitHubReader, path: string): Promise<unknown> {
  const response = await github.request({ method: "GET", path });
  return response.body;
}

function parseChangedLines(patch: string): readonly number[] {
  const lines = patch.split("\n");
  const changedLines: number[] = [];
  let newLine = 0;
  for (const line of lines) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (newLine === 0 || line.startsWith("\\ No newline")) {
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      changedLines.push(newLine);
      newLine += 1;
    } else if (!line.startsWith("-")) {
      newLine += 1;
    }
  }
  return changedLines;
}

function checkStatus(conclusion: unknown): CheckEvidence["status"] {
  if (conclusion === "success") {
    return "passed";
  }
  if (
    conclusion === "failure" ||
    conclusion === "cancelled" ||
    conclusion === "timed_out" ||
    conclusion === "action_required" ||
    conclusion === "startup_failure"
  ) {
    return "failed";
  }
  return "unknown";
}

function readNestedString(
  value: Record<string, unknown>,
  parent: string,
  child: string,
): string | null {
  const nested = value[parent];
  if (!isRecord(nested) || typeof nested[child] !== "string") {
    return null;
  }
  return nested[child];
}

function repositoryPath(owner: string, repo: string): string {
  return `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.status === 404;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
