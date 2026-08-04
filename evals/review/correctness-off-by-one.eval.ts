import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { reviewPromptFromFixture } from "../lib/review-prompt";

export default defineEval({
  description: "Flags an off-by-one sum regression as a high correctness finding.",
  tags: ["review", "correctness", "fixture"],
  async test(t) {
    await t.send(await reviewPromptFromFixture("correctness-off-by-one.md"));
    t.succeeded();
    t.check(t.reply, includes("## Curl review"));
    t.check(t.reply, includes("**Verdict:**"));
    t.check(t.reply, includes(/###\s+High/i));
    t.check(t.reply, includes(/off-by-one|sumUpTo|loop/i));
  },
});
