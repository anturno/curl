import { defineEvalConfig } from "eve/evals";

export default defineEvalConfig({
  // Deterministic format gates only in Phase 0; add a judge model when live grading lands.
  timeoutMs: 120_000,
  maxConcurrency: 2,
});
