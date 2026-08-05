import type { GitHubEventContext } from "eve/channels/github";
import { reviewConfig } from "./config";
import { isRecord, repoPath } from "./github-api";
import { buildGitHubFailureContext, logGitHubFailure } from "./github-failure";
import type { ReviewCheckRun } from "./review-check-run";

const CHECK_TEXT_MAX = 65_535;
const MAX_TRACKED_COMPLETIONS = 1_024;

type CheckConclusion = "cancelled" | "failure" | "neutral" | "success" | "timed_out";

interface ReviewCheckCompletion {
  readonly authoritative?: boolean;
  readonly conclusion?: CheckConclusion;
  readonly summary: string;
  readonly text?: string;
  readonly title: string;
}

/**
 * Serializes terminal writes and remembers their authority per check run.
 * The default exported helpers use one process-wide instance, while tests and
 * alternate compositions can construct an isolated coordinator.
 */
export class ReviewCompletionCoordinator {
  private readonly completionRecords = new Map<number, { readonly authoritative: boolean }>();
  private readonly completionLocks = new Map<number, Promise<void>>();

  constructor(private readonly maxTrackedCompletions = MAX_TRACKED_COMPLETIONS) {}

  complete(id: number, authoritative: boolean, task: () => Promise<boolean>): Promise<void> {
    return this.withLock(id, async () => {
      const current = this.completionRecords.get(id);
      if (authoritative && current?.authoritative) {
        return;
      }
      if (!authoritative && current) {
        return;
      }

      if (await task()) {
        this.remember(id, authoritative);
      }
    });
  }

  completeIfOpen(
    id: number,
    isAlreadyCompleted: () => Promise<boolean>,
    task: () => Promise<boolean>,
  ): Promise<void> {
    return this.withLock(id, async () => {
      if (this.completionRecords.has(id)) {
        return;
      }
      if (await isAlreadyCompleted()) {
        this.remember(id, false);
        return;
      }
      if (await task()) {
        this.remember(id, false);
      }
    });
  }

  private remember(id: number, authoritative: boolean): void {
    const current = this.completionRecords.get(id);
    if (current?.authoritative && !authoritative) {
      return;
    }
    this.completionRecords.delete(id);
    this.completionRecords.set(id, { authoritative });
    while (this.completionRecords.size > this.maxTrackedCompletions) {
      const oldest = this.completionRecords.keys().next().value;
      if (typeof oldest !== "number") {
        break;
      }
      this.completionRecords.delete(oldest);
    }
  }

  /** Serialize terminal writes for one check so a fallback cannot race a final. */
  private withLock(id: number, task: () => Promise<void>): Promise<void> {
    const previous = this.completionLocks.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.completionLocks.set(id, next);
    void next.then(
      () => {
        if (this.completionLocks.get(id) === next) {
          this.completionLocks.delete(id);
        }
      },
      () => {
        if (this.completionLocks.get(id) === next) {
          this.completionLocks.delete(id);
        }
      },
    );
    return next;
  }
}

const completionCoordinator = new ReviewCompletionCoordinator();

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

async function patchReviewCheckRun(
  channel: GitHubEventContext,
  input: ReviewCheckCompletion,
  checkRun: ReviewCheckRun,
): Promise<boolean> {
  try {
    const summary = truncate(input.summary, CHECK_TEXT_MAX);
    const text = input.text ? truncate(input.text, CHECK_TEXT_MAX) : undefined;

    await channel.github.request({
      method: "PATCH",
      path: `${repoPath(channel.state.owner, channel.state.repo)}/check-runs/${checkRun.id}`,
      body: {
        status: "completed",
        conclusion: input.conclusion ?? "neutral",
        output: {
          title: truncate(input.title, 255),
          summary,
          ...(text ? { text } : {}),
        },
      },
    });
    return true;
  } catch (error) {
    logGitHubFailure(buildGitHubFailureContext(channel, checkRun, "check-run.complete"), error);
    return false;
  }
}

/**
 * Complete the check run started for this session. Direct completion is
 * authoritative: a later turn-completed fallback cannot replace its detailed
 * output in the same process, while the check ID/SHA in auth keeps retries
 * pointed at the original run rather than a newer PR head.
 * Uses conclusion `neutral` by default so findings never block merges.
 */
export function completeReviewCheckRun(
  channel: GitHubEventContext,
  input: ReviewCheckCompletion,
  checkRun: ReviewCheckRun | null,
): Promise<void> {
  if (!reviewConfig.github.checkRunsEnabled || checkRun === null) {
    return Promise.resolve();
  }

  const authoritative = input.authoritative !== false;
  return completionCoordinator.complete(checkRun.id, authoritative, () =>
    patchReviewCheckRun(channel, input, checkRun),
  );
}

/**
 * Best-effort fallback for a turn that has no final message. It checks the
 * remote status before patching, so a detailed `message.completed` result is
 * not overwritten after a process restart. If the status read fails, patching
 * is still attempted to close an orphaned in-progress run; the per-check lock
 * also prevents a same-process race with the authoritative final handler.
 */
export function completeReviewCheckRunIfOpen(
  channel: GitHubEventContext,
  input: ReviewCheckCompletion,
  checkRun: ReviewCheckRun | null,
): Promise<void> {
  if (!reviewConfig.github.checkRunsEnabled || checkRun === null) {
    return Promise.resolve();
  }

  return completionCoordinator.completeIfOpen(
    checkRun.id,
    async () => {
      try {
        const response = await channel.github.request<unknown>({
          method: "GET",
          path: `${repoPath(channel.state.owner, channel.state.repo)}/check-runs/${checkRun.id}`,
        });
        return isRecord(response.body) && response.body.status === "completed";
      } catch (error) {
        logGitHubFailure(buildGitHubFailureContext(channel, checkRun, "check-run.status"), error);
        return false;
      }
    },
    () => patchReviewCheckRun(channel, { ...input, authoritative: false }, checkRun),
  );
}
