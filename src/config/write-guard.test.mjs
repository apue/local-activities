import { describe, expect, it } from "vitest";

import {
  assertHostedWriteAllowed,
  classifyWriteTarget,
  normalizeEvalUsageEnvironment,
  writeTargetSummary,
} from "./write-guard.mjs";

describe("write guard", () => {
  it("classifies local, test, preview, hosted, and production targets", () => {
    expect(classifyWriteTarget("http://localhost:3000").kind).toBe("local");
    expect(classifyWriteTarget("https://activities.example").kind).toBe("test");
    expect(classifyWriteTarget("https://branch-app.vercel.app").kind).toBe(
      "preview",
    );
    expect(classifyWriteTarget("https://local-activities.vercel.app").kind).toBe(
      "production",
    );
    expect(classifyWriteTarget("https://whatsinfor.me").kind).toBe(
      "production",
    );
    expect(classifyWriteTarget("https://app.example.org").kind).toBe("hosted");
  });

  it("refuses hosted writes unless explicitly allowed", () => {
    expect(() =>
      assertHostedWriteAllowed({
        command: "hosted_write",
        baseUrl: "https://branch-app.vercel.app",
      }),
    ).toThrow("hosted_write_requires_allow_hosted_write");

    expect(
      assertHostedWriteAllowed({
        command: "hosted_write",
        baseUrl: "https://branch-app.vercel.app",
        allowHostedWrite: true,
      }).kind,
    ).toBe("preview");
  });

  it("formats target summaries without secrets", () => {
    const summary = writeTargetSummary({
      command: "data_hygiene",
      target: classifyWriteTarget("https://branch-app.vercel.app"),
      runId: "run-1",
      writeMode: "collector_upload",
      usageEnvironment: "eval:local",
    });

    expect(summary).toContain("command=data_hygiene");
    expect(summary).toContain("target=preview");
    expect(summary).toContain("baseUrl=https://branch-app.vercel.app");
    expect(summary).not.toContain("secret");
  });

  it("keeps eval usage labels separate from production collector usage", () => {
    expect(normalizeEvalUsageEnvironment({})).toBe("eval:local");
    expect(normalizeEvalUsageEnvironment({ VERCEL_ENV: "production" })).toBe(
      "eval:production",
    );
    expect(normalizeEvalUsageEnvironment({ USAGE_ENVIRONMENT: "test" })).toBe(
      "eval:test",
    );
    expect(
      normalizeEvalUsageEnvironment({
        EVAL_USAGE_ENVIRONMENT: "eval:model-benchmark",
      }),
    ).toBe("eval:model-benchmark");
  });
});
