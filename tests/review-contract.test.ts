import { describe, expect, test } from "bun:test";
import { buildReviewContextMessage } from "../agent/lib/review-context";
import {
  buildReviewPolicyPlan,
  DEFAULT_REVIEW_POLICY,
  MAX_REVIEW_CANDIDATE_FINDINGS,
  MAX_REVIEW_FINDINGS,
  MAX_REVIEW_PATH_LENGTH,
  MAX_REVIEW_PATHS,
  MAX_REVIEW_SUMMARY_LENGTH,
  parsePolicyDocument,
  parseReviewCandidate,
  type ReviewCandidate,
  type ReviewContext,
  type ReviewFinding,
  renderReview,
  validateReview,
} from "../agent/lib/review-contract";
import { createReviewWorkflow, type ReviewChannel } from "../agent/lib/review-workflow";

const finding: ReviewFinding = {
  category: "security" as const,
  confidence: "high" as const,
  evidence: "The changed request path passes `userInput` directly to the shell.",
  fix: "Pass the value as a non-shell argument and validate the accepted command set.",
  impact: "An attacker can execute commands with the review service account privileges.",
  path: "src/runner.ts",
  rootCause: "User-controlled input reaches an executable shell sink.",
  endLine: 12,
  severity: "high" as const,
  startLine: 12,
  title: "User input reaches the shell",
};

const context: ReviewContext = {
  changedFiles: [
    {
      path: "src/runner.ts",
      changedLines: [10, 11, 12, 13],
      changedContent: [
        { line: 12, content: "exec(userInput);" },
        { line: 13, content: "exec(userInput);" },
      ],
    },
  ],
  policy: DEFAULT_REVIEW_POLICY,
};
describe("review contract", () => {
  test("accepts an explicitly empty review", () => {
    const candidate = parseReviewCandidate(
      JSON.stringify({
        findings: [],
        notes: [],
        scrutiny: [],
        verdict: "clean",
        version: 1,
      }),
    );

    if (!candidate) {
      throw new Error("expected an empty review candidate");
    }
    expect(validateReview(candidate, context)).toEqual({
      ok: true,
      review: {
        findings: [],
        notes: [],
        requiredChecks: [],
        verdict: "clean",
      },
    });
  });

  test("rejects malformed and out-of-diff findings", () => {
    expect(parseReviewCandidate("{}")).toBeNull();

    const candidate = validCandidate({
      path: "src/other.ts",
    });
    expect(validateReview(candidate, context)).toEqual({
      ok: false,
      reason: "invalid-semantic-content",
    });
  });

  test("rejects unsafe anchors and generic evidence", () => {
    expect(validateReview(validCandidate({ path: "../src/runner.ts" }), context)).toEqual({
      ok: false,
      reason: "invalid-semantic-content",
    });
    expect(
      validateReview(
        validCandidate({
          evidence: "This could be a potential problem with the change.",
        }),
        context,
      ),
    ).toEqual({
      ok: false,
      reason: "invalid-semantic-content",
    });
    expect(validateReview(validCandidate({ startLine: 9, endLine: 9 }), context)).toEqual({
      ok: false,
      reason: "invalid-semantic-content",
    });
    expect(
      validateReview(
        validCandidate({
          evidence: "The changed request path passes `otherInput` directly to the shell.",
        }),
        context,
      ),
    ).toEqual({
      ok: false,
      reason: "invalid-semantic-content",
    });
  });

  test("accepts evidence grounded in a changed-line snippet", () => {
    expect(validateReview(validCandidate(), context)).toMatchObject({
      ok: true,
      review: {
        findings: [expect.objectContaining({ evidence: expect.stringContaining("`userInput`") })],
      },
    });
  });

  test("rejects a tiny punctuation anchor and accepts a substantial exact anchor", () => {
    expect(
      validateReview(
        validCandidate({ evidence: "The changed call ends with `;` and is unsafe." }),
        context,
      ),
    ).toEqual({
      ok: false,
      reason: "invalid-semantic-content",
    });
    expect(
      validateReview(
        validCandidate({
          evidence: "The changed call `exec(userInput);` passes attacker input to a shell.",
        }),
        context,
      ),
    ).toMatchObject({ ok: true });
  });

  test("accepts a bounded range when it intersects a changed line", () => {
    const mixedRangeContext: ReviewContext = {
      ...context,
      changedFiles: [
        {
          path: "src/runner.ts",
          changedLines: [12],
          changedContent: [{ line: 12, content: "exec(userInput);" }],
        },
      ],
    };
    expect(
      validateReview(validCandidate({ startLine: 11, endLine: 13 }), mixedRangeContext),
    ).toMatchObject({ ok: true });
  });

  test("rejects a bounded range with no changed-line intersection", () => {
    const changedLineContext: ReviewContext = {
      ...context,
      changedFiles: [
        {
          path: "src/runner.ts",
          changedLines: [12],
          changedContent: [{ line: 12, content: "exec(userInput);" }],
        },
      ],
    };
    expect(
      validateReview(validCandidate({ startLine: 13, endLine: 14 }), changedLineContext),
    ).toEqual({ ok: false, reason: "invalid-semantic-content" });
  });

  test("filters speculative high-severity findings without failing the review", () => {
    const result = validateReview(validCandidate({ confidence: "low", severity: "high" }), context);
    expect(result).toMatchObject({
      ok: true,
      review: {
        findings: [],
        notes: ["1 candidate finding(s) were withheld by repository policy."],
        verdict: "clean",
      },
    });
  });

  test("rejects invalid enums and oversized structured results", () => {
    expect(
      parseReviewCandidate(
        JSON.stringify({
          findings: [{ ...finding, severity: "style" }],
          notes: [],
          scrutiny: [],
          verdict: "findings",
          version: 1,
        }),
      ),
    ).toBeNull();
    expect(
      parseReviewCandidate(
        JSON.stringify({
          findings: Array.from({ length: MAX_REVIEW_CANDIDATE_FINDINGS }, () => finding),
          notes: [],
          scrutiny: [],
          verdict: "findings",
          version: 1,
        }),
      ),
    ).not.toBeNull();
    expect(
      parseReviewCandidate(
        JSON.stringify({
          findings: Array.from({ length: 51 }, () => finding),
          notes: [],
          scrutiny: [],
          verdict: "findings",
          version: 1,
        }),
      ),
    ).toBeNull();
  });

  test("renders an empty review as a successful concise summary", () => {
    const candidate = parseReviewCandidate(
      JSON.stringify({
        findings: [],
        notes: [],
        scrutiny: [],
        verdict: "clean",
        version: 1,
      }),
    );
    if (!candidate) {
      throw new Error("expected an empty review candidate");
    }
    const result = validateReview(candidate, context);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(renderReview(result.review)).toContain("No correctness or security findings.");
  });

  test("retains generated correctness and security findings", () => {
    const candidate = validCandidate({
      category: "correctness",
      path: "generated/client.ts",
    });
    const generatedContext: ReviewContext = {
      ...context,
      changedFiles: [
        {
          path: "generated/client.ts",
          changedLines: [12],
          changedContent: [{ line: 12, content: "exec(userInput);" }],
        },
      ],
      policy: {
        ...DEFAULT_REVIEW_POLICY,
        generatedPaths: ["generated/**"],
        extraScrutinyPaths: ["generated/**"],
      },
    };
    const scrutiny = [
      {
        path: "generated/client.ts",
        evidence: [{ line: 12, content: "exec(userInput);" }],
        rationale: "Reviewed the generated shell sink `exec(userInput);` for security impact.",
      },
    ];

    expect(validateReview({ ...candidate, scrutiny }, generatedContext)).toMatchObject({
      ok: true,
      review: { findings: [expect.objectContaining({ category: "correctness" })] },
    });

    expect(
      validateReview(
        {
          ...validCandidate({ category: "security", path: "generated/client.ts" }),
          scrutiny,
        },
        generatedContext,
      ),
    ).toMatchObject({
      ok: true,
      review: { findings: [expect.objectContaining({ category: "security" })] },
    });
  });

  test("omits generated files from normal analysis but retains scrutinized files", () => {
    const files = [
      { path: "generated/client.ts", changedLines: [12], changedContent: [] },
      { path: "src/runner.ts", changedLines: [12], changedContent: [] },
      { path: "migrations/001.sql", changedLines: [12], changedContent: [] },
    ];
    const plan = buildReviewPolicyPlan(files, {
      ...DEFAULT_REVIEW_POLICY,
      generatedPaths: ["generated/**"],
      extraScrutinyPaths: ["src/**"],
      securitySensitivePaths: ["migrations/**"],
    });

    expect(plan.analysisFiles.map((file) => file.path)).toEqual([
      "src/runner.ts",
      "migrations/001.sql",
    ]);
    expect(plan.generatedFiles.map((file) => file.path)).toEqual(["generated/client.ts"]);
    expect(plan.scrutinizedPaths).toEqual(["src/runner.ts", "migrations/001.sql"]);
  });

  test("rejects policy scope that names an unchanged or unsafe path", () => {
    const candidate = {
      ...validCandidate(),
      scrutiny: [{ path: "src/runner.ts", evidence: [], rationale: "" }],
    };
    expect(validateReview(candidate, context)).toEqual({
      ok: false,
      reason: "invalid-semantic-content",
    });
    expect(
      validateReview(
        { ...validCandidate(), scrutiny: [{ path: "../src/runner.ts", evidence: [] }] },
        context,
      ),
    ).toEqual({
      ok: false,
      reason: "invalid-semantic-content",
    });
  });

  test("validates evidence before suppressing below-threshold findings", () => {
    const policyContext = {
      ...context,
      policy: { ...DEFAULT_REVIEW_POLICY, minimumPublicationSeverity: "high" as const },
    };
    expect(
      validateReview(
        validCandidate({
          evidence: "This could be a potential problem with the change.",
          severity: "low",
        }),
        policyContext,
      ),
    ).toEqual({
      ok: false,
      reason: "invalid-semantic-content",
    });
    expect(validateReview(validCandidate({ severity: "low" }), policyContext)).toMatchObject({
      ok: true,
      review: {
        findings: [],
        notes: ["1 candidate finding(s) were withheld by repository policy."],
        verdict: "clean",
      },
    });
  });

  test("deduplicates and orders findings before rendering", () => {
    const candidate: ReviewCandidate = {
      findings: [
        finding,
        {
          ...finding,
          title: "Duplicate at the same location",
        },
        {
          ...finding,
          endLine: 13,
          startLine: 13,
          rootCause: "User-controlled input reaches an executable shell sink.",
          title: "User input reaches the shell",
        },
        {
          ...finding,
          category: "correctness",
          confidence: "medium",
          severity: "medium",
          rootCause: "A second concrete defect has an executable shell consequence.",
          title: "A second concrete defect",
        },
      ],
      notes: [],
      scrutiny: [],
      verdict: "findings",
      version: 1,
    };
    const result = validateReview(candidate, context);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.review.findings).toHaveLength(3);
    expect(renderReview(result.review)).toMatch(/### High[\s\S]*### Medium/);
  });

  test("fails closed for malformed policy and reports unavailable checks", () => {
    expect(parsePolicyDocument('{"version":1,"generatedPaths":["../src/**"]}')).toBeNull();

    const candidate = validCandidate();
    const result = validateReview(candidate, {
      ...context,
      policy: {
        ...DEFAULT_REVIEW_POLICY,
        requiredChecks: ["build"],
      },
    });
    expect(result).toMatchObject({
      ok: true,
      review: {
        requiredChecks: [{ name: "build", status: "unknown" }],
        notes: ["Required checks: build=unknown."],
      },
    });
    if (result.ok) {
      expect(renderReview(result.review)).toContain("Required checks: build=unknown.");
    }
  });

  test("reports authoritative required checks in the single review summary", () => {
    const result = validateReview(validCandidate(), {
      ...context,
      checks: [
        { name: "typecheck", status: "passed" },
        { name: "typecheck", status: "failed" },
        { name: "test", status: "failed" },
      ],
      policy: {
        ...DEFAULT_REVIEW_POLICY,
        requiredChecks: ["typecheck", "test"],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      review: {
        requiredChecks: [
          { name: "typecheck", status: "unknown" },
          { name: "test", status: "failed" },
        ],
      },
    });
    if (result.ok) {
      expect(renderReview(result.review)).toContain(
        "Required checks: typecheck=unknown, test=failed.",
      );
    }
  });

  test("reports missing policy while retaining safe defaults", () => {
    const result = validateReview(validCandidate(), {
      ...context,
      policyStatus: "missing",
    });
    expect(result).toMatchObject({
      ok: true,
      review: {
        notes: ["Repository review policy was missing; safe defaults were used."],
      },
    });
  });

  test("requires and reports an extra-scrutiny pass", () => {
    const policyContext: ReviewContext = {
      ...context,
      policy: {
        ...DEFAULT_REVIEW_POLICY,
        extraScrutinyPaths: ["src/**"],
      },
    };
    expect(validateReview(validCandidate(), policyContext)).toEqual({
      ok: false,
      reason: "invalid-semantic-content",
    });
    expect(
      parseReviewCandidate(
        JSON.stringify({
          ...validCandidate(),
          scrutinizedPaths: ["src/runner.ts"],
        }),
      ),
    ).toBeNull();

    expect(
      validateReview(
        {
          ...validCandidate(),
          scrutiny: [{ path: "src/runner.ts", evidence: [] }],
        },
        policyContext,
      ),
    ).toEqual({
      ok: false,
      reason: "invalid-semantic-content",
    });

    const result = validateReview(
      {
        ...validCandidate(),
        scrutiny: [
          {
            path: "src/runner.ts",
            evidence: [{ line: 12, content: "exec(userInput);" }],
            rationale: "Reviewed the changed sink `exec(userInput);` for shell injection.",
          },
        ],
      },
      policyContext,
    );
    expect(result).toMatchObject({
      ok: true,
      review: { notes: ["Additional scrutiny completed for: src/runner.ts."] },
    });
    expect(
      validateReview(
        {
          ...validCandidate(),
          scrutiny: [
            {
              path: "src/runner.ts",
              evidence: [],
              rationale: "Reviewed the changed sink `exec(userInput);` for shell injection.",
            },
          ],
        },
        policyContext,
      ),
    ).toMatchObject({ ok: true });
  });

  test("rejects a rationale that only copies the changed line", () => {
    const policyContext: ReviewContext = {
      ...context,
      policy: {
        ...DEFAULT_REVIEW_POLICY,
        extraScrutinyPaths: ["src/**"],
      },
    };
    expect(
      validateReview(
        {
          ...validCandidate(),
          scrutiny: [
            {
              path: "src/runner.ts",
              evidence: [],
              rationale: "`exec(userInput);`",
            },
          ],
        },
        policyContext,
      ),
    ).toEqual({ ok: false, reason: "invalid-semantic-content" });
  });

  test("rejects missing or irrelevant scrutiny evidence", () => {
    const policyContext: ReviewContext = {
      ...context,
      policy: {
        ...DEFAULT_REVIEW_POLICY,
        extraScrutinyPaths: ["src/**"],
      },
    };
    const base = { ...validCandidate(), scrutiny: [{ path: "src/runner.ts", evidence: [] }] };

    expect(validateReview(base, policyContext)).toEqual({
      ok: false,
      reason: "invalid-semantic-content",
    });
    expect(
      validateReview(
        {
          ...base,
          scrutiny: [{ path: "src/runner.ts", evidence: [{ line: 12, content: "other();" }] }],
        },
        policyContext,
      ),
    ).toEqual({
      ok: false,
      reason: "invalid-semantic-content",
    });
  });

  test("requires stronger evidence on security-sensitive paths", () => {
    const policyContext: ReviewContext = {
      ...context,
      policy: {
        ...DEFAULT_REVIEW_POLICY,
        securitySensitivePaths: ["src/**"],
      },
    };
    expect(validateReview(validCandidate(), policyContext)).toEqual({
      ok: false,
      reason: "invalid-semantic-content",
    });

    expect(
      validateReview(
        {
          ...validCandidate(),
          scrutiny: [
            {
              path: "src/runner.ts",
              evidence: [{ line: 12, content: "exec(userInput);" }],
            },
          ],
        },
        policyContext,
      ),
    ).toEqual({
      ok: false,
      reason: "invalid-semantic-content",
    });

    const result = validateReview(
      {
        ...validCandidate(),
        scrutiny: [
          {
            path: "src/runner.ts",
            evidence: [{ line: 12, content: "exec(userInput);" }],
            rationale: "Reviewed the changed sink `exec(userInput);` for shell injection.",
          },
        ],
      },
      policyContext,
    );
    expect(result).toMatchObject({
      ok: true,
      review: { notes: ["Additional scrutiny completed for: src/runner.ts."] },
    });
  });

  test("supports the maximum scrutiny path count and rejects one above it", () => {
    const files = Array.from({ length: MAX_REVIEW_PATHS }, (_, index) => ({
      path: `src/file-${index}.ts`,
      changedLines: [1],
      changedContent: [{ line: 1, content: `const value = ${index};` }],
    }));
    const serialized = {
      findings: [],
      notes: [],
      scrutiny: files.map((file) => ({
        path: file.path,
        evidence: [{ line: 1, content: file.changedContent[0].content }],
        rationale: `Reviewed the changed line \`${file.changedContent[0].content}\` for correctness and security.`,
      })),
      verdict: "clean" as const,
      version: 1 as const,
    };
    const parsed = parseReviewCandidate(JSON.stringify(serialized));
    expect(parsed).not.toBeNull();
    if (!parsed) {
      return;
    }
    expect(
      validateReview(parsed, {
        changedFiles: files,
        policy: { ...DEFAULT_REVIEW_POLICY, extraScrutinyPaths: ["src/**"] },
      }),
    ).toMatchObject({ ok: true });
    expect(
      parseReviewCandidate(
        JSON.stringify({
          ...serialized,
          scrutiny: [
            ...serialized.scrutiny,
            { path: "src/one-too-many.ts", evidence: [{ line: 1, content: "extra" }] },
          ],
        }),
      ),
    ).toBeNull();
  });

  test("renders a 300-path review with maximum-length paths concisely", () => {
    const files = Array.from({ length: MAX_REVIEW_PATHS }, (_, index) => {
      const prefix = `src/${index.toString().padStart(3, "0")}/`;
      return {
        path: `${prefix}${"x".repeat(MAX_REVIEW_PATH_LENGTH - prefix.length)}`,
        changedLines: [1],
        changedContent: [{ line: 1, content: "const changed = true;" }],
      };
    });
    const maximumPolicy = {
      ...DEFAULT_REVIEW_POLICY,
      extraScrutinyPaths: [
        "**",
        ...Array.from({ length: 49 }, (_, index) => `extra-${index}-${"x".repeat(190)}`),
      ],
      frameworks: Array.from({ length: 20 }, (_, index) => `framework-${index}-${"f".repeat(80)}`),
      generatedPaths: Array.from(
        { length: 50 },
        (_, index) => `generated-${index}-${"g".repeat(180)}`,
      ),
      languages: Array.from({ length: 20 }, (_, index) => `language-${index}-${"l".repeat(80)}`),
      requiredChecks: Array.from({ length: 50 }, (_, index) => `check-${index}-${"c".repeat(190)}`),
      securitySensitivePaths: [
        ...Array.from({ length: 50 }, (_, index) => `sensitive-${index}-${"s".repeat(180)}`),
      ],
    };
    const selectedPaths = JSON.parse(
      buildReviewContextMessage({
        changedFiles: files,
        policy: maximumPolicy,
      }).slice("<curl_review_context>\n".length, -"\n</curl_review_context>".length),
    ).policyApplication.requiredScrutinyPaths as string[];
    const candidate: ReviewCandidate = {
      findings: [],
      notes: [],
      scrutiny: selectedPaths.map((path: string) => ({
        path,
        evidence: [{ line: 1, content: "const changed = true;" }],
        rationale:
          "Reviewed the changed line `const changed = true;` for correctness and security.",
      })),
      verdict: "clean",
      version: 1,
    };

    const result = validateReview(candidate, {
      changedFiles: files,
      checks: maximumPolicy.requiredChecks.map((name) => ({ name, status: "passed" as const })),
      policy: maximumPolicy,
    });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      const summary = renderReview(result.review);
      expect(summary.length).toBeLessThanOrEqual(MAX_REVIEW_SUMMARY_LENGTH);
      expect(summary).toContain(files[0].path.slice(0, 117));
      expect(summary).toContain(`${selectedPaths.length - 3} scrutiny path(s) not listed`);
      const omittedPath = files.find((file) => !selectedPaths.includes(file.path));
      expect(omittedPath).toBeDefined();
      if (omittedPath) {
        expect(summary).not.toContain(omittedPath.path);
      }
    }
  });

  test("accepts the maximum bounded contract fields", () => {
    const maxCheckName = "c".repeat(200);
    const candidate = {
      findings: [
        {
          ...finding,
          evidence: `${"e".repeat(1_988)} \`userInput\``,
          fix: "f".repeat(2_000),
          impact: "i".repeat(2_000),
          rootCause: "r".repeat(500),
          title: "t".repeat(300),
        },
      ],
      notes: Array.from({ length: 5 }, () => "n".repeat(500)),
      scrutiny: [
        {
          path: "src/runner.ts",
          evidence: Array.from({ length: 100 }, () => ({
            line: 12,
            content: "exec(userInput);",
          })),
          rationale: `${"r".repeat(1_980)} \`exec(userInput);\``,
        },
      ],
      verdict: "findings" as const,
      version: 1 as const,
    };

    const parsed = parseReviewCandidate(JSON.stringify(candidate));
    expect(parsed).not.toBeNull();
    if (!parsed) {
      return;
    }
    const result = validateReview(parsed, {
      ...context,
      checks: [{ name: maxCheckName, status: "passed" }],
      policy: {
        ...DEFAULT_REVIEW_POLICY,
        extraScrutinyPaths: ["src/**"],
        requiredChecks: [maxCheckName],
      },
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(
        result.review.notes.some((note) =>
          note.includes(`Required checks: ${maxCheckName.slice(0, 100)}`),
        ),
      ).toBe(true);
      expect(renderReview(result.review).length).toBeLessThanOrEqual(MAX_REVIEW_SUMMARY_LENGTH);
    }
  });

  test("keeps every mandatory note ahead of candidate notes", () => {
    const policyContext: ReviewContext = {
      ...context,
      changedFilesTruncated: true,
      policyStatus: "missing",
      policy: {
        ...DEFAULT_REVIEW_POLICY,
        extraScrutinyPaths: ["src/**"],
        generatedPaths: ["src/**"],
        requiredChecks: ["typecheck"],
      },
      checks: [{ name: "typecheck", status: "passed" }],
    };
    const result = validateReview(
      {
        ...validCandidate(),
        scrutiny: [
          {
            path: "src/runner.ts",
            evidence: [{ line: 12, content: "exec(userInput);" }],
            rationale: "Reviewed the changed sink `exec(userInput);` for shell injection.",
          },
        ],
        notes: ["candidate note 1", "candidate note 2", "candidate note 3", "candidate note 4"],
      },
      policyContext,
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) {
      return;
    }
    expect(result.review.notes).toEqual([
      "Repository review policy was missing; safe defaults were used.",
      "Changed-file input was truncated at 300 paths; some omitted path(s) were not reviewed.",
      "Review context was bounded at 100000 characters; 1 path(s), 0 changed line number(s), and 0 changed content snippet(s) were omitted from model context.",
      "Additional scrutiny completed for: src/runner.ts.",
      "Required checks: typecheck=passed.",
      "candidate note 1",
      "candidate note 2",
      "candidate note 3",
      "candidate note 4",
    ]);
  });

  test("rejects a just-over-budget summary at the maximum rendered finding count", () => {
    const files = Array.from({ length: MAX_REVIEW_FINDINGS }, (_, index) => ({
      path: `src/runner-${index}.ts`,
      changedLines: [12],
      changedContent: [{ line: 12, content: `exec(userInput${index});` }],
    }));
    const candidate = {
      findings: files.map((file, index) => ({
        ...finding,
        evidence: `${"e".repeat(1_950)} \`userInput${index}\``,
        fix: "f".repeat(2_000),
        impact: "i".repeat(2_000),
        path: file.path,
        rootCause: `Root cause ${index} reaches an executable shell sink.`,
        title: `Finding ${index} has a deliberately bounded title`,
      })),
      notes: [],
      scrutiny: [],
      verdict: "findings" as const,
      version: 1 as const,
    };
    const parsed = parseReviewCandidate(JSON.stringify(candidate));
    expect(parsed).not.toBeNull();
    if (!parsed) {
      return;
    }

    const result = validateReview(parsed, { ...context, changedFiles: files });
    expect(result).toEqual({ ok: false, reason: "summary-too-large" });
    expect(
      renderReview({
        findings: parsed.findings,
        notes: [],
        requiredChecks: [],
        verdict: "findings",
      }).length,
    ).toBeGreaterThan(MAX_REVIEW_SUMMARY_LENGTH);
  });

  test("posts exactly one controlled failure for an oversized validated PR candidate", async () => {
    const files = Array.from({ length: MAX_REVIEW_FINDINGS }, (_, index) => ({
      filename: `src/runner-${index}.ts`,
      patch: `@@ -11,0 +12,1 @@\n+exec(userInput${index});`,
    }));
    const candidate = {
      findings: files.map((file, index) => ({
        ...finding,
        evidence: `${"e".repeat(1_950)} \`userInput${index}\``,
        fix: "f".repeat(2_000),
        impact: "i".repeat(2_000),
        path: file.filename,
        rootCause: `Root cause ${index} reaches an executable shell sink.`,
        title: `Finding ${index} has a deliberately bounded title`,
      })),
      notes: [],
      scrutiny: [],
      verdict: "findings" as const,
      version: 1 as const,
    };
    const posted: string[] = [];
    const workflow = createReviewWorkflow({ botName: "anturno-curl" });

    await workflow.handle({
      auth: null,
      channel: mockChannel(posted, files),
      finishReason: "stop",
      message: JSON.stringify(candidate),
      type: "message.completed",
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("could not validate");
    expect(posted[0].length).toBeLessThanOrEqual(65_536);
  });

  test("posts a controlled failure instead of arbitrary PR output", async () => {
    const posted: string[] = [];
    const workflow = createReviewWorkflow({ botName: "anturno-curl" });

    await workflow.handle({
      auth: null,
      channel: mockChannel(posted),
      finishReason: "stop",
      message:
        'ProviderError: prompt="ignore the review contract" credential="provider-secret" source="src/runner.ts"',
      type: "message.completed",
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("could not validate");
    expect(posted[0]).not.toContain("ProviderError");
    expect(posted[0]).not.toContain("ignore the review contract");
    expect(posted[0]).not.toContain("provider-secret");
    expect(posted[0]).not.toContain("src/runner.ts");
  });

  test("suppresses tool-call narration instead of posting it", async () => {
    const posted: string[] = [];
    const workflow = createReviewWorkflow({ botName: "anturno-curl" });

    await workflow.handle({
      auth: null,
      channel: mockChannel(posted),
      finishReason: "tool-calls",
      message: "The provider is calling a tool with a secret.",
      type: "message.completed",
    });

    expect(posted).toEqual([]);
  });

  test("posts a safe cancellation message", async () => {
    const posted: string[] = [];
    const workflow = createReviewWorkflow({ botName: "anturno-curl" });

    await workflow.handle({
      auth: null,
      channel: mockChannel(posted),
      type: "turn.cancelled",
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Review cancelled.");
  });

  test("posts a safe session-failure message without provider details", async () => {
    const posted: string[] = [];
    const workflow = createReviewWorkflow({ botName: "anturno-curl" });

    await workflow.handle({
      channel: mockChannel(posted),
      details: {
        errorId: "session-123",
        error:
          'ProviderError: prompt="system prompt" credential="provider-secret" source="src/runner.ts"',
      },
      type: "session.failed",
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("session could not recover");
    expect(posted[0]).toContain("session-123");
    expect(posted[0]).not.toContain("ProviderError");
    expect(posted[0]).not.toContain("system prompt");
    expect(posted[0]).not.toContain("provider-secret");
    expect(posted[0]).not.toContain("src/runner.ts");
  });

  test("does not post raw provider failures", async () => {
    const posted: string[] = [];
    const workflow = createReviewWorkflow({ botName: "anturno-curl" });

    await workflow.handle({
      auth: null,
      channel: mockChannel(posted),
      details: {
        error:
          'ProviderError: prompt="system prompt" credential="provider-secret" source="src/runner.ts"',
      },
      type: "turn.failed",
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("hit an error");
    expect(posted[0]).not.toContain("ProviderError");
    expect(posted[0]).not.toContain("system prompt");
    expect(posted[0]).not.toContain("provider-secret");
    expect(posted[0]).not.toContain("src/runner.ts");
  });

  test("renders one validated summary for a PR", async () => {
    const posted: string[] = [];
    const workflow = createReviewWorkflow({ botName: "anturno-curl" });

    await workflow.handle({
      auth: null,
      channel: mockChannel(posted),
      finishReason: "stop",
      message: JSON.stringify(validCandidate()),
      type: "message.completed",
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("## Curl review");
    expect(posted[0]).toContain("User input reaches the shell");
    expect(posted[0].length).toBeLessThanOrEqual(MAX_REVIEW_SUMMARY_LENGTH);
  });
});

function validCandidate(overrides: Partial<typeof finding> = {}): ReviewCandidate {
  return {
    findings: [{ ...finding, ...overrides }],
    notes: [],
    scrutiny: [],
    verdict: "findings",
    version: 1,
  };
}

function mockChannel(
  posted: string[],
  compareFiles: readonly { readonly filename: string; readonly patch: string }[] = [
    {
      filename: "src/runner.ts",
      patch: "@@ -11,2 +11,3 @@\n context\n+exec(userInput);\n context",
    },
  ],
): ReviewChannel {
  return {
    github: {
      request: async ({ path }: { readonly path: string }) => {
        if (path.includes("/pulls/23")) {
          return {
            body: { base: { sha: "base-sha" }, head: { sha: "head-sha" } },
            ok: true,
            status: 200,
          };
        }
        if (path.includes("/compare/")) {
          return {
            body: {
              files: compareFiles,
            },
            ok: true,
            status: 200,
          };
        }
        if (path.includes("/contents/")) {
          throw { status: 404 };
        }
        return { body: { check_runs: [] }, ok: true, status: 200 };
      },
    },
    state: {
      baseRef: "main",
      baseSha: "base-sha",
      checkoutPath: null,
      conversationKind: "pull_request",
      defaultBranch: "main",
      headRef: "feature",
      headSha: "head-sha",
      installationId: 1,
      issueNumber: 23,
      owner: "anturno",
      pullRequestNumber: 23,
      repo: "curl",
      repositoryId: 1,
      reviewCommentId: null,
      reviewThreadRootCommentId: null,
      triggeringCommentId: 1,
      triggeringUserLogin: "author",
    },
    thread: {
      post: async (message: string) => {
        posted.push(message);
        return { id: 1, raw: {}, htmlUrl: undefined, url: undefined };
      },
    },
    // The channel mock implements only the runtime fields exercised by this workflow.
  };
}
