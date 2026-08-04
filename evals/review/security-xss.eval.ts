import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";
import { reviewPromptFromFixture } from "../lib/review-prompt";

export default defineEval({
  description: "Flags XSS via unsanitized innerHTML as a critical/high security finding.",
  tags: ["review", "security", "fixture"],
  async test(t) {
    await t.send(await reviewPromptFromFixture("security-xss.md"));
    t.succeeded();
    t.check(t.reply, includes("## Curl review"));
    t.check(t.reply, includes("**Verdict:**"));
    t.check(t.reply, includes(/###\s+Critical/i));
    t.check(t.reply, includes(/innerHTML|XSS/i));
    t.check(
      t.reply,
      satisfies(
        (reply) => typeof reply === "string" && /needs changes/i.test(reply),
        "verdict needs changes",
      ),
    );
  },
});
