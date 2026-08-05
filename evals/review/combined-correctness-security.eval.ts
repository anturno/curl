import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";
import { reviewPromptFromFixture } from "../lib/review-prompt";

export default defineEval({
  description: "Keeps independent correctness and security defects in one prioritized summary.",
  tags: ["review", "quality", "correctness", "security", "combined", "fixture"],
  async test(t) {
    await t.send(await reviewPromptFromFixture("combined-correctness-security.md"));
    t.succeeded();
    t.check(t.reply, includes("## Curl review"));
    t.check(t.reply, includes(/\*\*Verdict:\*\*\s*needs changes/i));
    t.check(t.reply, includes(/###\s+Critical/i));
    t.check(t.reply, includes(/###\s+High/i));
    t.check(t.reply, includes(/innerHTML|XSS/i));
    t.check(t.reply, includes(/off-by-one|sumUpTo/i));
    t.check(
      t.reply,
      satisfies((reply) => {
        if (typeof reply !== "string") {
          return false;
        }
        const summaryHeaders = [...reply.matchAll(/^## Curl review$/gim)];
        const critical = reply.search(/^###\s+Critical\s*$/im);
        const high = reply.search(/^###\s+High\s*$/im);
        return summaryHeaders.length === 1 && critical >= 0 && high > critical;
      }, "one summary with severity ordering"),
    );
    t.check(
      t.reply,
      satisfies(
        (reply) => typeof reply === "string" && reply.length < 2_000,
        "concise combined summary",
      ),
    );
  },
});
