import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";
import { reviewPromptFromFixture } from "../lib/review-prompt";

export default defineEval({
  description: "Does not invent findings for intentional defensive boundary validation.",
  tags: ["review", "quality", "clean", "defensive", "fixture"],
  async test(t) {
    await t.send(await reviewPromptFromFixture("clean-defensive.md"));
    t.succeeded();
    t.check(t.reply, includes("## Curl review"));
    t.check(t.reply, includes(/\*\*Verdict:\*\*\s*ship/i));
    t.check(
      t.reply,
      satisfies(
        (reply) => typeof reply === "string" && !/###\s+(Critical|High|Medium)/i.test(reply),
        "no correctness or security finding",
      ),
    );
  },
});
