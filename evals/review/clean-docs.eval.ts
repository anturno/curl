import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";
import { reviewPromptFromFixture } from "../lib/review-prompt";

export default defineEval({
  description: "Docs-only PR ships with no correctness/security findings.",
  tags: ["review", "clean", "fixture"],
  async test(t) {
    await t.send(await reviewPromptFromFixture("clean-docs.md"));
    t.succeeded();
    t.check(t.reply, includes("## Curl review"));
    t.check(t.reply, includes(/\*\*Verdict:\*\*\s*ship/i));
    t.check(
      t.reply,
      satisfies(
        (reply) => typeof reply === "string" && !/###\s+Critical/i.test(reply),
        "no Critical section",
      ),
    );
  },
});
