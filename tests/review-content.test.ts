import { describe, expect, test } from "bun:test";
import {
  failureComment,
  normalizeBotName,
  shouldDispatchBotMention,
  splitCommentBody,
} from "../agent/lib/review-content";

describe("review content helpers", () => {
  test("normalizes bot name", () => {
    expect(normalizeBotName("anturno-curl")).toBe("anturno-curl");
    expect(normalizeBotName("anturno-curl[bot]")).toBe("anturno-curl");
  });

  test("detects mention", () => {
    expect(
      shouldDispatchBotMention({ body: "@anturno-curl review", botName: "anturno-curl" }),
    ).toBe(true);
    expect(
      shouldDispatchBotMention({
        body: "@anturno-curledge review",
        botName: "anturno-curl",
      }),
    ).toBe(false);
    expect(
      shouldDispatchBotMention({
        body: "@anturno-curl review",
        botName: "anturno-curl",
        authorType: "Bot",
      }),
    ).toBe(false);
  });

  test("splits long bodies", () => {
    const body = "x".repeat(70_000);
    const chunks = splitCommentBody(body, 65_536);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(65_536);
    }
  });

  test("builds failure comment", () => {
    const comment = failureComment("It failed.", "err-123");
    expect(comment).toInclude("It failed.");
    expect(comment).toInclude("err-123");
  });
});
