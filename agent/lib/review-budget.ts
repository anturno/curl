import type { ChangedFile, ChangedLine, ReviewContext, ReviewPolicyPlan } from "./review-contract";

/**
 * This is a conservative character budget for the configured 200,000-token
 * model context. The complete serialized context, including its policy and
 * omission metadata, must fit below this single limit.
 */
export const MAX_REVIEW_CONTEXT_LENGTH = 100_000;

export interface ReviewContextSelection {
  readonly changedFiles: readonly ChangedFile[];
  readonly omittedPaths: number;
  readonly omittedChangedLines: number;
  readonly omittedChangedContent: number;
  readonly omittedScrutinyPaths: number;
  readonly unavailableDiffPaths: number;
  readonly omittedPathExamples: readonly string[];
}

interface MutableChangedFile {
  readonly source: ChangedFile;
  readonly changedLines: number[];
  readonly changedContent: ChangedLine[];
}

export function selectReviewContext(
  context: ReviewContext,
  policyPlan: ReviewPolicyPlan,
): ReviewContextSelection {
  const mutableFiles: MutableChangedFile[] = [];
  for (const file of policyPlan.analysisFiles.filter(
    (file) => file.diffEvidence !== "unavailable",
  )) {
    const candidate: MutableChangedFile = {
      source: file,
      changedLines: [],
      changedContent: [],
    };
    mutableFiles.push(candidate);
    if (
      serializeSelection(context, policyPlan, makeSelection(context, policyPlan, mutableFiles))
        .length > MAX_REVIEW_CONTEXT_LENGTH
    ) {
      mutableFiles.pop();
    }
  }

  let estimatedLength = serializeSelection(
    context,
    policyPlan,
    makeSelection(context, policyPlan, mutableFiles),
  ).length;

  /*
   * Content is the useful grounding evidence, so give each selected path a
   * deterministic round-robin opportunity before spending the remaining
   * budget on line-number-only evidence.  A content item always brings its
   * changed line number with it.
   */
  let contentIndex = 0;
  let contentProgress = true;
  while (contentProgress) {
    contentProgress = false;
    for (const file of mutableFiles) {
      const content = file.source.changedContent[contentIndex];
      if (!content) {
        continue;
      }
      const previousLines = file.changedLines.length;
      const previousContent = file.changedContent.length;
      const lineDelta = file.changedLines.includes(content.line)
        ? 0
        : JSON.stringify(content.line).length + (previousLines === 0 ? 0 : 1);
      const contentDelta =
        JSON.stringify({ line: content.line, content: content.content }).length +
        (previousContent === 0 ? 0 : 1);
      if (!file.changedLines.includes(content.line)) {
        file.changedLines.push(content.line);
      }
      file.changedContent.push(content);
      if (estimatedLength + lineDelta + contentDelta > MAX_REVIEW_CONTEXT_LENGTH) {
        file.changedLines.length = previousLines;
        file.changedContent.length = previousContent;
      } else {
        estimatedLength += lineDelta + contentDelta;
        contentProgress = true;
      }
    }
    contentIndex += 1;
  }

  let lineIndex = 0;
  let lineProgress = true;
  while (lineProgress) {
    lineProgress = false;
    for (const file of mutableFiles) {
      const line = file.source.changedLines[lineIndex];
      if (line === undefined || file.changedLines.includes(line)) {
        continue;
      }
      const lineDelta = JSON.stringify(line).length + (file.changedLines.length === 0 ? 0 : 1);
      if (estimatedLength + lineDelta <= MAX_REVIEW_CONTEXT_LENGTH) {
        file.changedLines.push(line);
        estimatedLength += lineDelta;
        lineProgress = true;
      }
    }
    lineIndex += 1;
  }

  let selection = makeSelection(context, policyPlan, mutableFiles);
  while (
    serializeSelection(context, policyPlan, selection).length > MAX_REVIEW_CONTEXT_LENGTH &&
    mutableFiles.length > 0
  ) {
    const lastFile = mutableFiles[mutableFiles.length - 1];
    if (lastFile.changedContent.length > 0) {
      lastFile.changedContent.pop();
    } else if (lastFile.changedLines.length > 0) {
      lastFile.changedLines.pop();
    } else {
      mutableFiles.pop();
    }
    selection = makeSelection(context, policyPlan, mutableFiles);
  }
  return selection;
}

export function serializeReviewContext(
  context: ReviewContext,
  policyPlan: ReviewPolicyPlan,
): string {
  const selection = selectReviewContext(context, policyPlan);
  const payload = buildPayload(context, policyPlan, selection);
  return `<curl_review_context>\n${JSON.stringify(payload)}\n</curl_review_context>`;
}

function serializeSelection(
  context: ReviewContext,
  policyPlan: ReviewPolicyPlan,
  selection: ReviewContextSelection,
): string {
  return `<curl_review_context>\n${JSON.stringify(
    buildPayload(context, policyPlan, selection),
  )}\n</curl_review_context>`;
}

function buildPayload(
  context: ReviewContext,
  policyPlan: ReviewPolicyPlan,
  selection: ReviewContextSelection,
) {
  const selectedFiles = new Map(selection.changedFiles.map((file) => [file.path, file]));
  const selectedScrutinyPaths = policyPlan.scrutinizedPaths.filter(
    (path) => (selectedFiles.get(path)?.changedContent.length ?? 0) > 0,
  );
  const generatedPaths = policyPlan.generatedFiles.map((file) => file.path);
  const omittedGeneratedPaths = policyPlan.generatedFiles
    .filter((file) => !policyPlan.scrutinizedPaths.includes(file.path))
    .map((file) => file.path);
  return {
    changedFiles: selection.changedFiles.map(serializeChangedFile),
    contextBudget: {
      maxCharacters: MAX_REVIEW_CONTEXT_LENGTH,
      omittedChangedContent: selection.omittedChangedContent,
      omittedChangedLines: selection.omittedChangedLines,
      omittedPathExamples: selection.omittedPathExamples,
      omittedPaths: selection.omittedPaths,
      unavailableDiffPaths: selection.unavailableDiffPaths,
    },
    changedFilesTruncated: context.changedFilesTruncated ?? false,
    policy: context.policy,
    policyApplication: {
      generatedFiles: boundedPathList(generatedPaths).values,
      generatedFilesOmittedCount: boundedPathList(generatedPaths).omittedCount,
      omittedGeneratedFiles: boundedPathList(omittedGeneratedPaths).values,
      omittedGeneratedFilesCount: boundedPathList(omittedGeneratedPaths).omittedCount,
      requiredScrutinyPaths: selectedScrutinyPaths,
      requiredScrutinyPathsOmittedCount: selection.omittedScrutinyPaths,
    },
    policyStatus: context.policyStatus ?? "valid",
  };
}

function makeSelection(
  context: ReviewContext,
  policyPlan: ReviewPolicyPlan,
  mutableFiles: readonly MutableChangedFile[],
): ReviewContextSelection {
  const selectedPaths = new Set(mutableFiles.map((file) => file.source.path));
  const eligibleFiles = policyPlan.analysisFiles;
  const changedFiles = mutableFiles.map((file) => ({
    path: file.source.path,
    ...(file.source.diffEvidence === "unavailable" ? { diffEvidence: "unavailable" as const } : {}),
    changedLines: [...file.changedLines],
    changedContent: [...file.changedContent],
  }));
  const omittedChangedLines = eligibleFiles.reduce((total, file) => {
    const selected = mutableFiles.find((candidate) => candidate.source.path === file.path);
    return total + Math.max(0, file.changedLines.length - (selected?.changedLines.length ?? 0));
  }, 0);
  const omittedChangedContent = eligibleFiles.reduce((total, file) => {
    const selected = mutableFiles.find((candidate) => candidate.source.path === file.path);
    return total + Math.max(0, file.changedContent.length - (selected?.changedContent.length ?? 0));
  }, 0);
  const omittedPathExamples = eligibleFiles
    .filter((file) => !selectedPaths.has(file.path) && file.diffEvidence !== "unavailable")
    .map((file) => shortenPath(file.path))
    .slice(0, 3);
  const externalOmittedPaths =
    context.changedFilesOmittedPaths ?? (context.changedFilesTruncated ? 1 : 0);
  const unavailableDiffPaths = context.changedFiles.filter(
    (file) => file.diffEvidence === "unavailable",
  ).length;
  const unavailableEligiblePaths = eligibleFiles.filter(
    (file) => file.diffEvidence === "unavailable",
  ).length;
  const selectedScrutinyPaths = policyPlan.scrutinizedPaths.filter((path) => {
    const selected = mutableFiles.find((file) => file.source.path === path);
    return (selected?.changedContent.length ?? 0) > 0;
  });
  return {
    changedFiles,
    omittedChangedContent,
    omittedChangedLines,
    omittedScrutinyPaths: policyPlan.scrutinizedPaths.length - selectedScrutinyPaths.length,
    omittedPathExamples,
    omittedPaths:
      externalOmittedPaths + eligibleFiles.length - selectedPaths.size - unavailableEligiblePaths,
    unavailableDiffPaths,
  };
}

function serializeChangedFile(file: ChangedFile): Record<string, unknown> {
  return {
    path: file.path,
    ...(file.diffEvidence === "unavailable" ? { diffEvidence: "unavailable" } : {}),
    changedLines: file.changedLines,
    changedContent: file.changedContent,
  };
}

function boundedPathList(values: readonly string[]): {
  readonly values: readonly string[];
  readonly omittedCount: number;
} {
  return { values: values.slice(0, 3), omittedCount: Math.max(0, values.length - 3) };
}

function shortenPath(path: string): string {
  return path.length <= 200 ? path : `${path.slice(0, 197)}...`;
}
