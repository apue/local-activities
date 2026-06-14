import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildCandidatePacket } from "./candidate-packet.mjs";
import { runCheapTriage } from "./cheap-triage.mjs";
import { cleanCapturedArticleBundle } from "./content-cleaner.mjs";
import {
  mockEditorPass,
  mockFullExtract,
  publishTraceFromEditor,
  validateMockExtraction,
} from "./mock-harnesses.mjs";
import { scoreNormalizedContent } from "./signal-scorer.mjs";

const fixedNow = "2026-06-10T03:00:00.000Z";

describe("V5 mock Full Extract and Editor harnesses", () => {
  it("turns expected corpus event drafts into stable mock extraction output with attempts metadata", async () => {
    const caseItem = await loadCase("beiping-beer-festival-guide");
    const normalized = cleanCapturedArticleBundle(caseItem.bundle);
    const signalScore = scoreNormalizedContent(normalized);
    const packet = buildCandidatePacket({ normalized, signalScore });
    const triage = await runCheapTriage({ packet, now: fixedNow });

    const extraction = mockFullExtract({
      normalized,
      packet,
      triage,
      expected: caseItem.expected,
      now: fixedNow,
    });

    expect(extraction).toMatchObject({
      version: "v5-mock-full-extract.v1",
      decision: "event",
      provider: "mock",
      model: "mock-full-extract",
      promptVersion: "v5-full-extract.mock-prompt.v1",
      schemaVersion: "v5-extraction-result.v1",
      confidence: expect.any(Number),
    });
    expect(extraction.events).toHaveLength(caseItem.expected.eventCount);
    expect(extraction.events[0]).toMatchObject({
      title: "北平机器友谊万岁精酿啤酒节",
      organizer: "北平机器",
      venue: "友谊花园",
    });
    expect(extraction.attempts).toEqual([
      expect.objectContaining({
        attempt: 1,
        provider: "mock",
        model: "mock-full-extract",
        usage: extraction.usage,
        startedAt: fixedNow,
        finishedAt: fixedNow,
        validatorIssues: [],
      }),
    ]);
  });

  it("keeps excluded corpus cases auditable", async () => {
    const caseItem = await loadCase("turkey-president-meeting-news");
    const normalized = cleanCapturedArticleBundle(caseItem.bundle);

    const extraction = mockFullExtract({
      normalized,
      expected: caseItem.expected,
      now: fixedNow,
    });
    const validation = validateMockExtraction({ extraction, normalized, now: fixedNow });
    const editor = mockEditorPass({ normalized, extraction, validation, now: fixedNow });
    const publishTrace = publishTraceFromEditor({ extraction, validation, editor });

    expect(extraction).toMatchObject({
      decision: "non_event",
      events: [],
    });
    expect(validation.status).toBe("invalid");
    expect(editor.editorDecision).toBe("exclude");
    expect(publishTrace.state).toBe("excluded");
    expect(publishTrace.reasons).toEqual(expect.arrayContaining(["mock_non_event"]));
  });

  it("validates missing event facts as needs_info and terminally excludes them", async () => {
    const normalized = cleanCapturedArticleBundle({
      title: "测试活动",
      sourceName: "Test Source",
      sourceUrl: "https://mp.weixin.qq.com/s/mock",
      publishedAt: "2026-06-10T00:00:00.000Z",
      text: "测试活动，欢迎参加。",
      links: [],
      images: [],
      miniPrograms: [],
    });
    const extraction = mockFullExtract({
      normalized,
      expected: {
        action: "review",
        eventCount: 1,
        eventDrafts: [{ title: "测试活动" }],
        publish: { state: "needs_info", reasons: ["missing_time_place"] },
      },
      now: fixedNow,
    });

    const validation = validateMockExtraction({ extraction, normalized, now: fixedNow });
    const editor = mockEditorPass({ normalized, extraction, validation, now: fixedNow });
    const publishTrace = publishTraceFromEditor({ extraction, validation, editor });

    expect(validation.status).toBe("needs_info");
    expect(validation.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["event_start_missing", "event_venue_missing"]),
    );
    expect(editor.editorDecision).toBe("exclude");
    expect(publishTrace.state).toBe("excluded");
  });

  it("publishes complete expected review cases when the extracted event is valid", () => {
    const normalized = cleanCapturedArticleBundle({
      title: "测试活动需审核",
      sourceName: "Test Source",
      sourceUrl: "https://mp.weixin.qq.com/s/review",
      publishedAt: "2026-06-10T00:00:00.000Z",
      text: "测试活动，6月20日 19:00 在北京文化中心举办，报名证据缺失。",
      links: [],
      images: [],
      miniPrograms: [],
    });
    const extraction = mockFullExtract({
      normalized,
      expected: {
        action: "review",
        eventCount: 1,
        eventDrafts: [{
          title: "测试活动需审核",
          startsAt: "2026-06-20T19:00:00+08:00",
          venueName: "北京文化中心",
        }],
      },
      now: fixedNow,
    });

    const validation = validateMockExtraction({ extraction, normalized, now: fixedNow });
    const editor = mockEditorPass({ normalized, extraction, validation, now: fixedNow });
    const publishTrace = publishTraceFromEditor({ extraction, validation, editor });

    expect(extraction.decision).toBe("event");
    expect(validation.status).toBe("valid");
    expect(editor.editorDecision).toBe("publish");
    expect(publishTrace.state).toBe("published");
  });

  it("terminally excludes expected missing registration evidence cases", async () => {
    const caseItem = await loadCase("bac-equality-history-talk");
    const normalized = cleanCapturedArticleBundle(caseItem.bundle);
    const extraction = mockFullExtract({
      normalized,
      expected: caseItem.expected,
      now: fixedNow,
    });

    const validation = validateMockExtraction({ extraction, normalized, now: fixedNow });
    const editor = mockEditorPass({ normalized, extraction, validation, now: fixedNow });
    const publishTrace = publishTraceFromEditor({ extraction, validation, editor });

    expect(extraction.decision).toBe("event");
    expect(validation.status).toBe("needs_info");
    expect(validation.issues.map((issue) => issue.code)).toContain("registration_evidence_missing");
    expect(editor.editorDecision).toBe("exclude");
    expect(publishTrace.state).toBe("excluded");
  });
});

async function loadCase(caseId) {
  const caseDir = path.resolve("tests/regression-corpus", caseId);
  const [bundle, expected] = await Promise.all([
    readJson(path.join(caseDir, "captured-bundle.json")),
    readJson(path.join(caseDir, "expected.json")),
  ]);
  return { bundle, expected };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
