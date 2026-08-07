import { z } from "zod";
import { MAX_REVIEW_CONTEXT_LENGTH, selectReviewContext } from "./review-budget";

export const REVIEW_CONTRACT_VERSION = 1;
export const MAX_REVIEW_CANDIDATE_FINDINGS = 50;
export const MAX_REVIEW_FINDINGS = 10;
export const MAX_REVIEW_NOTES = 5;
export const MAX_REVIEW_NOTE_LENGTH = 500;
export const MAX_REVIEW_PATHS = 300;
/** The complete validated PR summary must fit below GitHub's 65,536 limit. */
export const MAX_REVIEW_SUMMARY_LENGTH = 60_000;
export const MAX_REVIEW_PATH_LENGTH = 500;
export const MAX_REVIEW_SCRUTINY_EVIDENCE = 100;
export const MIN_GROUNDED_SNIPPET_LENGTH = 8;

const severitySchema = z.enum(["critical", "high", "medium", "low"]);
const confidenceSchema = z.enum(["high", "medium", "low"]);
const categorySchema = z.enum(["correctness", "security"]);

const findingSchema = z
  .object({
    category: categorySchema,
    confidence: confidenceSchema,
    evidence: z.string().trim().min(20).max(2_000),
    fix: z.string().trim().min(10).max(2_000),
    impact: z.string().trim().min(10).max(2_000),
    path: z.string().trim().min(1).max(MAX_REVIEW_PATH_LENGTH),
    rootCause: z.string().trim().min(10).max(500),
    endLine: z.number().int().positive(),
    severity: severitySchema,
    startLine: z.number().int().positive(),
    title: z.string().trim().min(5).max(300),
  })
  .strict();

const scrutinyEvidenceSchema = z
  .object({
    line: z.number().int().positive(),
    content: z.string().trim().min(1).max(500),
  })
  .strict();

const scrutinyResultSchema = z
  .object({
    evidence: z.array(scrutinyEvidenceSchema).max(MAX_REVIEW_SCRUTINY_EVIDENCE).default([]),
    path: z.string().trim().min(1).max(MAX_REVIEW_PATH_LENGTH),
    rationale: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

const reviewCandidateSchema = z
  .object({
    findings: z.array(findingSchema).max(MAX_REVIEW_CANDIDATE_FINDINGS),
    notes: z.array(z.string().trim().min(1).max(MAX_REVIEW_NOTE_LENGTH)).max(MAX_REVIEW_NOTES),
    scrutiny: z.array(scrutinyResultSchema).max(MAX_REVIEW_PATHS).default([]),
    verdict: z.enum(["clean", "findings"]),
    version: z.literal(REVIEW_CONTRACT_VERSION),
  })
  .strict();

const policySchema = z
  .object({
    extraScrutinyPaths: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
    frameworks: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    generatedPaths: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
    languages: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    minimumPublicationConfidence: confidenceSchema.default("medium"),
    minimumPublicationSeverity: severitySchema.default("low"),
    requiredChecks: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
    securitySensitivePaths: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
    version: z.literal(REVIEW_CONTRACT_VERSION),
  })
  .strict();

export type ReviewSeverity = z.infer<typeof severitySchema>;
export type ReviewConfidence = z.infer<typeof confidenceSchema>;
export type ReviewCategory = z.infer<typeof categorySchema>;
export type ReviewFinding = z.infer<typeof findingSchema>;
export type ReviewScrutinyResult = z.infer<typeof scrutinyResultSchema>;
export type ReviewCandidate = z.infer<typeof reviewCandidateSchema>;
export type ReviewPolicy = z.infer<typeof policySchema>;

export interface ChangedFile {
  readonly path: string;
  readonly changedLines: readonly number[];
  /**
   * Bounded source snippets for the changed lines. Findings must quote a
   * snippet from this manifest in their evidence.
   */
  readonly changedContent: readonly ChangedLine[];
  readonly diffEvidence?: "unavailable";
}

export interface ChangedLine {
  readonly line: number;
  readonly content: string;
}

export interface CheckEvidence {
  readonly name: string;
  readonly status: "passed" | "failed" | "unknown";
}

export interface ReviewContext {
  readonly changedFiles: readonly ChangedFile[];
  readonly changedFilesTruncated?: boolean;
  readonly changedFilesOmittedPaths?: number;
  readonly checks?: readonly CheckEvidence[];
  readonly policyStatus?: "invalid" | "missing" | "valid";
  readonly policy: ReviewPolicy;
}

export interface ReviewPolicyPlan {
  readonly analysisFiles: readonly ChangedFile[];
  readonly generatedFiles: readonly ChangedFile[];
  readonly extraScrutinyPaths: readonly string[];
  readonly securitySensitivePaths: readonly string[];
  readonly scrutinizedPaths: readonly string[];
}

export interface ValidatedReview {
  readonly findings: readonly ReviewFinding[];
  readonly notes: readonly string[];
  readonly requiredChecks: readonly CheckEvidence[];
  readonly verdict: "clean" | "findings";
}

export type ReviewValidationResult =
  | { readonly ok: true; readonly review: ValidatedReview }
  | { readonly ok: false; readonly reason: ReviewValidationFailure };

export type ReviewValidationFailure =
  | "invalid-json"
  | "invalid-schema"
  | "invalid-semantic-content"
  | "missing-diff-context"
  | "summary-too-large";

export const DEFAULT_REVIEW_POLICY: ReviewPolicy = {
  extraScrutinyPaths: [],
  frameworks: [],
  generatedPaths: [],
  languages: [],
  minimumPublicationConfidence: "medium",
  minimumPublicationSeverity: "low",
  requiredChecks: [],
  securitySensitivePaths: [],
  version: REVIEW_CONTRACT_VERSION,
};

const severityRank: Record<ReviewSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const confidenceRank: Record<ReviewConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export function parseReviewCandidate(message: string): ReviewCandidate | null {
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    return null;
  }
  const result = reviewCandidateSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseReviewPolicy(value: unknown): ReviewPolicy | null {
  const result = policySchema.safeParse(value);
  if (!result.success) {
    return null;
  }
  if (
    [
      ...result.data.extraScrutinyPaths,
      ...result.data.generatedPaths,
      ...result.data.securitySensitivePaths,
    ].some((path) => !isSafePolicyPath(path))
  ) {
    return null;
  }
  return result.data;
}

export function buildReviewPolicyPlan(
  changedFiles: readonly ChangedFile[],
  policy: ReviewPolicy,
): ReviewPolicyPlan {
  const generatedFiles = changedFiles.filter((file) =>
    isMatchedPath(file.path, policy.generatedPaths),
  );
  const extraScrutinyPaths = changedFiles
    .filter((file) => isMatchedPath(file.path, policy.extraScrutinyPaths))
    .map((file) => file.path);
  const securitySensitivePaths = changedFiles
    .filter((file) => isMatchedPath(file.path, policy.securitySensitivePaths))
    .map((file) => file.path);
  const scrutinizedPaths = uniquePaths([...extraScrutinyPaths, ...securitySensitivePaths]);

  return {
    analysisFiles: changedFiles.filter(
      (file) =>
        !isMatchedPath(file.path, policy.generatedPaths) || scrutinizedPaths.includes(file.path),
    ),
    generatedFiles,
    extraScrutinyPaths: uniquePaths(extraScrutinyPaths),
    securitySensitivePaths: uniquePaths(securitySensitivePaths),
    scrutinizedPaths,
  };
}

export function validateReview(
  candidate: ReviewCandidate,
  context: ReviewContext,
): ReviewValidationResult {
  if (context.changedFiles.length === 0) {
    return { ok: false, reason: "missing-diff-context" };
  }

  const sourcePolicyPlan = buildReviewPolicyPlan(context.changedFiles, context.policy);
  const contextSelection = selectReviewContext(context, sourcePolicyPlan);
  const selectedPolicyPlan = buildReviewPolicyPlan(contextSelection.changedFiles, context.policy);
  const selectedEvidencePaths = new Set(
    contextSelection.changedFiles
      .filter((file) => file.changedContent.length > 0)
      .map((file) => file.path),
  );
  const effectivePolicyPlan: ReviewPolicyPlan = {
    ...selectedPolicyPlan,
    extraScrutinyPaths: selectedPolicyPlan.extraScrutinyPaths.filter((path) =>
      selectedEvidencePaths.has(path),
    ),
    securitySensitivePaths: selectedPolicyPlan.securitySensitivePaths.filter((path) =>
      selectedEvidencePaths.has(path),
    ),
    scrutinizedPaths: selectedPolicyPlan.scrutinizedPaths.filter((path) =>
      selectedEvidencePaths.has(path),
    ),
  };
  const changedFiles = new Map(contextSelection.changedFiles.map((file) => [file.path, file]));
  const scrutinyByPath = new Map(candidate.scrutiny.map((result) => [result.path, result]));
  if (
    scrutinyByPath.size !== candidate.scrutiny.length ||
    candidate.scrutiny.some(
      (result) =>
        !isSafeFindingPath(result.path) ||
        !changedFiles.has(result.path) ||
        !effectivePolicyPlan.scrutinizedPaths.includes(result.path),
    ) ||
    effectivePolicyPlan.scrutinizedPaths.some((path) => {
      const result = scrutinyByPath.get(path);
      const file = changedFiles.get(path);
      return !result || !file || !isValidScrutinyResult(result, file, effectivePolicyPlan);
    })
  ) {
    return { ok: false, reason: "invalid-semantic-content" };
  }
  const findings: ReviewFinding[] = [];
  let suppressedFindings = 0;

  for (const finding of candidate.findings) {
    if (!isSafeFindingPath(finding.path)) {
      return { ok: false, reason: "invalid-semantic-content" };
    }
    const file = changedFiles.get(finding.path);
    if (
      !file ||
      !isValidLineRange(finding, file.changedLines) ||
      !isGroundedEvidence(finding, file.changedContent)
    ) {
      return { ok: false, reason: "invalid-semantic-content" };
    }
    if (
      severityRank[finding.severity] < severityRank[context.policy.minimumPublicationSeverity] ||
      confidenceRank[finding.confidence] <
        confidenceRank[context.policy.minimumPublicationConfidence]
    ) {
      suppressedFindings += 1;
      continue;
    }
    if (
      effectivePolicyPlan.scrutinizedPaths.includes(finding.path) &&
      finding.confidence !== "high"
    ) {
      suppressedFindings += 1;
      continue;
    }
    findings.push(finding);
  }

  const deduplicated = deduplicateFindings(findings).slice(0, MAX_REVIEW_FINDINGS);
  const requiredChecks = resolveRequiredChecks(context.policy.requiredChecks, context.checks);
  const mandatoryNotes = [
    ...(context.policyStatus === "invalid" || context.policyStatus === "missing"
      ? [`Repository review policy was ${context.policyStatus}; safe defaults were used.`]
      : []),
    ...(suppressedFindings > 0
      ? [`${suppressedFindings} candidate finding(s) were withheld by repository policy.`]
      : []),
    ...(context.changedFilesTruncated
      ? [
          `Changed-file input was truncated at ${MAX_REVIEW_PATHS} paths; ${context.changedFilesOmittedPaths ?? "some"} omitted path(s) were not reviewed.`,
        ]
      : []),
    ...(contextSelection.omittedPaths > 0 ||
    contextSelection.omittedChangedLines > 0 ||
    contextSelection.omittedChangedContent > 0 ||
    contextSelection.omittedScrutinyPaths > 0
      ? [
          `Review context was bounded at ${MAX_REVIEW_CONTEXT_LENGTH} characters; ${contextSelection.omittedPaths} path(s), ${contextSelection.omittedChangedLines} changed line number(s), and ${contextSelection.omittedChangedContent} changed content snippet(s) were omitted from model context.`,
        ]
      : []),
    ...(contextSelection.omittedScrutinyPaths > 0
      ? [
          `${contextSelection.omittedScrutinyPaths} scrutiny path(s) were not part of the bounded validated scrutiny surface.`,
        ]
      : []),
    ...(contextSelection.unavailableDiffPaths > 0
      ? [
          `Changed diff evidence was unavailable for ${contextSelection.unavailableDiffPaths} path(s); findings requiring exact diff evidence were withheld.`,
        ]
      : []),
    ...buildPolicyNotes(effectivePolicyPlan),
    ...buildGeneratedNotes(sourcePolicyPlan),
    ...buildCheckNotes(requiredChecks),
  ];
  const notes = [...mandatoryNotes, ...candidate.notes];

  if (candidate.verdict === "clean" && candidate.findings.length > 0) {
    return { ok: false, reason: "invalid-semantic-content" };
  }
  if (candidate.verdict === "findings" && candidate.findings.length === 0) {
    return { ok: false, reason: "invalid-semantic-content" };
  }

  const review: ValidatedReview = {
    findings: deduplicated,
    notes,
    requiredChecks,
    verdict: deduplicated.length > 0 ? "findings" : "clean",
  };
  return renderReview(review).length <= MAX_REVIEW_SUMMARY_LENGTH
    ? { ok: true, review }
    : { ok: false, reason: "summary-too-large" };
}

export function renderReview(review: ValidatedReview): string {
  const verdict =
    review.findings.length === 0
      ? "ship"
      : review.findings.some(
            (finding) => finding.severity === "critical" || finding.severity === "high",
          )
        ? "needs changes"
        : "ship with fixes";
  const sections = [
    "## Curl review",
    `**Verdict:** ${verdict}`,
    "**Focus:** correctness + security",
  ];

  for (const severity of ["critical", "high", "medium", "low"] as const) {
    const findings = review.findings.filter((finding) => finding.severity === severity);
    if (findings.length === 0) {
      continue;
    }
    sections.push("", `### ${capitalize(severity)}`);
    for (const finding of findings) {
      sections.push(
        `- **${finding.title}** (\`${finding.path}:L${formatLineRange(finding)}\`, ${finding.confidence} confidence): ${finding.impact} Evidence: ${finding.evidence} Fix: ${finding.fix}`,
      );
    }
  }

  if (review.findings.length === 0) {
    sections.push("", "No correctness or security findings.");
  }
  if (review.notes.length > 0) {
    sections.push("", "### Notes", ...review.notes.map((note) => `- ${note}`));
  }
  return sections.join("\n");
}

export function parsePolicyDocument(text: string): ReviewPolicy | null {
  if (text.length > 65_536) {
    return null;
  }
  try {
    return parseReviewPolicy(JSON.parse(text));
  } catch {
    return null;
  }
}

function isValidLineRange(
  finding: Pick<ReviewFinding, "startLine" | "endLine">,
  changedLines: readonly number[],
): boolean {
  if (finding.startLine > finding.endLine || finding.endLine - finding.startLine > 20) {
    return false;
  }
  return changedLines.some((line) => line >= finding.startLine && line <= finding.endLine);
}

function isSafeFindingPath(path: string): boolean {
  return (
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

function isGroundedEvidence(
  finding: Pick<ReviewFinding, "evidence" | "startLine" | "endLine">,
  changedContent: readonly ChangedLine[],
): boolean {
  const anchors = [...finding.evidence.matchAll(/`([^`\r\n]{1,500})`/gu)].map(
    (match) => match[1]?.trim() ?? "",
  );
  return anchors.some((anchor) => {
    const normalizedAnchor = normalizeSource(anchor);
    return (
      isSubstantialAnchor(normalizedAnchor) &&
      changedContent.some(
        (line) =>
          line.line >= finding.startLine &&
          line.line <= finding.endLine &&
          normalizeSource(line.content).includes(normalizedAnchor),
      )
    );
  });
}

function isValidScrutinyResult(
  result: ReviewScrutinyResult,
  file: ChangedFile,
  policyPlan: ReviewPolicyPlan,
): boolean {
  const hasChangedContentEvidence = result.evidence.some((evidence) =>
    file.changedContent.some(
      (line) =>
        line.line === evidence.line &&
        normalizeSource(line.content) === normalizeSource(evidence.content),
    ),
  );
  const hasGroundedRationale =
    result.rationale !== undefined && isGroundedRationale(result.rationale, file.changedContent);
  if (policyPlan.securitySensitivePaths.includes(result.path)) {
    return hasChangedContentEvidence && hasGroundedRationale;
  }
  return hasGroundedRationale;
}

function isGroundedRationale(text: string, changedContent: readonly ChangedLine[]): boolean {
  const anchors = [...text.matchAll(/`([^`\r\n]{1,500})`/gu)].map(
    (match) => match[1]?.trim() ?? "",
  );
  const prose = text.replace(/`[^`\r\n]{1,500}`/gu, "").trim();
  return (
    prose.length >= 20 &&
    /[\p{L}]/u.test(prose) &&
    anchors.some((anchor) => {
      const normalizedAnchor = normalizeSource(anchor);
      return (
        isSubstantialAnchor(normalizedAnchor) &&
        changedContent.some((line) => normalizeSource(line.content).includes(normalizedAnchor))
      );
    })
  );
}

function isSubstantialAnchor(value: string): boolean {
  return value.length >= MIN_GROUNDED_SNIPPET_LENGTH && /[\p{L}\p{N}]/u.test(value);
}

function deduplicateFindings(findings: readonly ReviewFinding[]): ReviewFinding[] {
  const seen = new Set<string>();
  return [...findings].sort(compareFindings).filter((finding) => {
    const key = [
      normalizeForComparison(finding.rootCause),
      finding.path,
      finding.startLine,
      finding.endLine,
    ].join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function compareFindings(left: ReviewFinding, right: ReviewFinding): number {
  return (
    severityRank[right.severity] - severityRank[left.severity] ||
    confidenceRank[right.confidence] - confidenceRank[left.confidence] ||
    left.path.localeCompare(right.path) ||
    left.startLine - right.startLine ||
    left.endLine - right.endLine ||
    normalizeForComparison(left.rootCause).localeCompare(normalizeForComparison(right.rootCause)) ||
    left.category.localeCompare(right.category) ||
    left.title.localeCompare(right.title) ||
    normalizeForComparison(left.evidence).localeCompare(normalizeForComparison(right.evidence)) ||
    normalizeForComparison(left.impact).localeCompare(normalizeForComparison(right.impact)) ||
    normalizeForComparison(left.fix).localeCompare(normalizeForComparison(right.fix))
  );
}

function resolveRequiredChecks(
  names: readonly string[],
  checks: readonly CheckEvidence[] | undefined,
): CheckEvidence[] {
  return names.map((name) => {
    const evidence = checks?.filter((check) => check.name === name) ?? [];
    return evidence.length === 1 ? evidence[0] : { name, status: "unknown" };
  });
}

function buildPolicyNotes(policyPlan: ReviewPolicyPlan): string[] {
  return policyPlan.scrutinizedPaths.length > 0
    ? boundedListNotes(
        "Additional scrutiny completed for: ",
        policyPlan.scrutinizedPaths,
        "scrutiny path(s)",
      )
    : [];
}

function buildGeneratedNotes(policyPlan: ReviewPolicyPlan): string[] {
  const omittedPaths = policyPlan.generatedFiles
    .filter((file) => !policyPlan.scrutinizedPaths.includes(file.path))
    .map((file) => file.path);
  return omittedPaths.length > 0
    ? boundedListNotes(
        "Generated files omitted from normal analysis: ",
        uniquePaths(omittedPaths),
        "generated path(s)",
      )
    : [];
}

function buildCheckNotes(checks: readonly CheckEvidence[]): string[] {
  return checks.length > 0
    ? boundedListNotes(
        "Required checks: ",
        checks.map((check) => `${check.name}=${check.status}`),
        "check(s)",
      )
    : [];
}

function boundedListNotes(prefix: string, values: readonly string[], itemLabel: string): string[] {
  const representativeValues = values.slice(0, 3).map(shortenListValue);
  const omitted = values.length - representativeValues.length;
  const detail = representativeValues.join(", ");
  const limitation =
    omitted > 0 ? `; ${omitted} ${itemLabel} not listed to keep this note bounded` : "";
  return [`${prefix}${detail}${limitation}.`];
}

function shortenListValue(value: string): string {
  return value.length <= 120 ? value : `${value.slice(0, 117)}...`;
}

function isMatchedPath(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globMatches(path, pattern));
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

function globMatches(path: string, pattern: string): boolean {
  const pathParts = path.split("/");
  const patternParts = pattern.split("/");
  const memo = new Map<string, boolean>();

  function match(pathIndex: number, patternIndex: number): boolean {
    const key = `${pathIndex}:${patternIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const result =
      patternIndex === patternParts.length
        ? pathIndex === pathParts.length
        : patternParts[patternIndex] === "**"
          ? match(pathIndex, patternIndex + 1) ||
            (pathIndex < pathParts.length && match(pathIndex + 1, patternIndex))
          : pathIndex < pathParts.length &&
            segmentMatches(pathParts[pathIndex], patternParts[patternIndex]) &&
            match(pathIndex + 1, patternIndex + 1);
    memo.set(key, result);
    return result;
  }

  return match(0, 0);
}

function segmentMatches(value: string, pattern: string): boolean {
  let expression = "^";
  for (const character of pattern) {
    if (character === "*") {
      expression += ".*";
    } else if (character === "?") {
      expression += ".";
    } else {
      expression += escapeRegExp(character);
    }
  }
  return new RegExp(`${expression}$`, "u").test(value);
}

function isSafePolicyPath(value: string): boolean {
  return (
    value.length <= 200 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").some((part) => part === "" || part === "." || part === "..") &&
    !/[()[\]{}|+]/u.test(value)
  );
}

function normalizeForComparison(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function normalizeSource(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function formatLineRange(finding: Pick<ReviewFinding, "startLine" | "endLine">): string {
  return finding.startLine === finding.endLine
    ? `${finding.startLine}`
    : `${finding.startLine}-${finding.endLine}`;
}

function capitalize(value: string): string {
  return value[0].toUpperCase() + value.slice(1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
