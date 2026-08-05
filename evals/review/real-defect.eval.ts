import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";
import { reviewPromptFromFixture } from "../lib/review-prompt";

export default defineEval({
  description: "Reports a reachable authorization regression with evidence and a fix direction.",
  tags: ["review", "quality", "real-defect", "security", "fixture"],
  async test(t) {
    await t.send(await reviewPromptFromFixture("real-defect.md"));
    t.succeeded();
    t.check(t.reply, includes("## Curl review"));
    t.check(t.reply, includes(/\*\*Verdict:\*\*\s*needs changes/i));
    t.check(t.reply, includes(/###\s+High/i));
    t.check(t.reply, includes(/canDelete|viewer|source-backed/i));
    t.check(
      t.reply,
      satisfies(
        (reply) =>
          typeof reply === "string" &&
          /restrict|role|owner|fix/i.test(reply) &&
          /src\/permissions\.ts/i.test(reply),
        "localized evidence and fix direction",
      ),
    );
  },
});
