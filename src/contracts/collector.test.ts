import { describe, expect, it } from "vitest";

import {
  captureModeSchema,
  collectorEnvelopeSchema,
  eventDraftUploadSchema,
} from "./collector";

describe("collector contracts", () => {
  it("accepts a collector event draft with optional extracted fields", () => {
    const result = collectorEnvelopeSchema(eventDraftUploadSchema).parse({
      collectorId: "home-192-168-0-16",
      runId: "run-2026-05-28-001",
      observedAt: "2026-05-28T07:00:00.000Z",
      payloadVersion: "2026-05-collector-v1",
      payload: {
        articleUrl: "https://mp.weixin.qq.com/s/example",
        extractionAttemptId: "attempt-001",
        captureMode: "image_with_qr_registration",
        timezone: "Asia/Shanghai",
        city: "Beijing",
        reservationStatus: "unknown",
        signals: ["image_dominant", "registration_evidence_required"],
        evidenceAssetIds: ["asset-poster-1", "asset-qr-1"],
        fieldEvidence: {
          title: ["asset-poster-1"],
          registrationUrl: ["asset-qr-1"],
        },
        confidence: 0.62,
      },
    });

    expect(result.payload.title).toBeUndefined();
    expect(result.payload.signals).toContain("registration_evidence_required");
  });

  it("rejects unknown collector payload versions", () => {
    expect(() =>
      collectorEnvelopeSchema(eventDraftUploadSchema).parse({
        collectorId: "home-collector",
        runId: "run-1",
        observedAt: "2026-05-28T07:00:00.000Z",
        payloadVersion: "older-version",
        payload: {
          articleUrl: "https://example.com/a",
          extractionAttemptId: "attempt-001",
          captureMode: "text_complete",
          timezone: "Asia/Shanghai",
          city: "Beijing",
          signals: ["ready_for_review"],
          evidenceAssetIds: [],
          fieldEvidence: {},
          confidence: 0.9,
        },
      }),
    ).toThrow();
  });

  it("does not allow collector uploads to set publication state", () => {
    expect(() =>
      eventDraftUploadSchema.parse({
        articleUrl: "https://example.com/a",
        extractionAttemptId: "attempt-001",
        captureMode: "text_complete",
        timezone: "Asia/Shanghai",
        city: "Beijing",
        signals: ["ready_for_review"],
        evidenceAssetIds: [],
        fieldEvidence: {},
        confidence: 0.9,
        publishState: "published",
      }),
    ).toThrow();
  });

  it("keeps capture modes aligned with documented page modes", () => {
    expect(captureModeSchema.options).toEqual([
      "text_complete",
      "text_with_qr_registration",
      "image_dominant",
      "image_with_qr_registration",
      "not_activity",
      "unsupported",
    ]);
  });
});
