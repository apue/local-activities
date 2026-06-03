import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  collectorEnvelopeSchema,
  excludedArticleUploadSchema,
  type ArticleSnapshot,
} from "../contracts/collector";
import {
  buildExcludedArticleEnvelope,
  parseRecordedTriageResponse,
  routeTriageDecision,
  triagePromptVersion,
  triageSchemaVersion,
} from "./editorial-triage-service";

const articleSnapshot: ArticleSnapshot = {
  canonicalUrl: "https://mp.weixin.qq.com/s/official-visit",
  finalUrl: "https://mp.weixin.qq.com/s/official-visit",
  title: "德国联邦经济和能源部长北京访问行程",
  capturedAt: "2026-06-03T08:00:00.000Z",
  languageHints: ["zh"],
  captureMode: "text_complete",
  visibleText: "Minister visit itinerary and official meetings.",
  evidenceAssetIds: ["asset-visit-1"],
  contentHash: "hash-visit",
};

describe("editorial triage service", () => {
  it("parses recorded triage responses with provider metadata", () => {
    const result = parseRecordedTriageResponse({
      provider: "recorded",
      model: "fixture-model",
      content: {
        triageDecision: "official_visit",
        triageAction: "exclude",
        confidence: 0.94,
        publicSignals: [],
        exclusionSignals: ["Official delegation itinerary"],
        publicEligibility: "not_public",
        eventKind: "visit",
        exclusionReason: "Not open to ordinary attendees.",
      },
    });

    expect(result).toMatchObject({
      promptVersion: triagePromptVersion,
      schemaVersion: triageSchemaVersion,
      triageDecision: "official_visit",
      triageAction: "exclude",
      provider: "recorded",
      model: "fixture-model",
    });
  });

  it("rejects malformed triage responses", () => {
    expect(() =>
      parseRecordedTriageResponse({
        provider: "recorded",
        model: "fixture-model",
        content: {
          triageDecision: "official_visit",
          triageAction: "extract",
          confidence: 2,
        },
      }),
    ).toThrow("triage_response_invalid");
  });

  it("routes public, possible public, and excluded decisions separately", () => {
    expect(
      routeTriageDecision({ triageDecision: "public_activity" }),
    ).toMatchObject({
      route: "extract",
      canAutoPublishFromTriage: false,
    });
    expect(
      routeTriageDecision({ triageDecision: "possible_public_activity" }),
    ).toMatchObject({
      route: "review_then_extract",
      canAutoPublishFromTriage: false,
    });
    expect(routeTriageDecision({ triageDecision: "official_visit" })).toEqual({
      route: "exclude",
      canAutoPublishFromTriage: false,
    });
  });

  it("builds excluded article envelopes instead of event drafts", () => {
    const triage = parseRecordedTriageResponse({
      provider: "recorded",
      model: "fixture-model",
      content: {
        triageDecision: "official_visit",
        triageAction: "exclude",
        confidence: 0.94,
        publicSignals: [],
        exclusionSignals: ["Official visit"],
        publicEligibility: "not_public",
        eventKind: "visit",
        exclusionReason: "Official visit, not public registration.",
      },
    });

    const envelope = buildExcludedArticleEnvelope({
      collectorId: "collector-1",
      runId: "run-triage",
      observedAt: "2026-06-03T08:00:00.000Z",
      articleSnapshot,
      triage,
    });

    expect(envelope.payload).toMatchObject({
      articleUrl: "https://mp.weixin.qq.com/s/official-visit",
      triageDecision: "official_visit",
      triageAction: "exclude",
      confidence: 0.94,
      evidenceAssetIds: ["asset-visit-1"],
      promptVersion: triagePromptVersion,
      schemaVersion: triageSchemaVersion,
      provider: "recorded",
      model: "fixture-model",
    });
    expect(() =>
      collectorEnvelopeSchema(excludedArticleUploadSchema).parse(envelope),
    ).not.toThrow();
  });

  it("replays recorded fixture triage responses", () => {
    expect(
      parseRecordedTriageResponse(readFixtureTriage("korean-red-flavor")),
    ).toMatchObject({
      triageDecision: "public_activity",
      triageAction: "extract",
    });
    expect(
      parseRecordedTriageResponse(readFixtureTriage("official-visit-news")),
    ).toMatchObject({
      triageDecision: "official_visit",
      triageAction: "exclude",
    });
  });
});

function readFixtureTriage(caseId: string) {
  return JSON.parse(
    readFileSync(
      path.join(
        process.cwd(),
        "fixtures",
        "event-pipeline-v2",
        caseId,
        "triage-response.json",
      ),
      "utf8",
    ),
  );
}
