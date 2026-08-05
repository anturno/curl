import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";
import { reviewPromptFromFixture } from "../lib/review-prompt";

export default defineEval({
  description: "Does not report an injection finding refuted by validation and query binding.",
  tags: ["review", "quality", "refuted-candidate", "fixture"],
  async test(t) {
    await t.send(await reviewPromptFromFixture("refuted-candidate.md"));
    t.succeeded();
    t.check(t.reply, includes("## Curl review"));
    t.check(t.reply, includes(/\*\*Verdict:\*\*\s*ship/i));
    t.check(
      t.reply,
      satisfies(
        (reply) => typeof reply === "string" && !/###\s+(Critical|High|Medium)/i.test(reply),
        "no unconfirmed finding",
      ),
    );
  },
});
