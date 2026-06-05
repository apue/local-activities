import { describe, expect, it } from "vitest";

import {
  formatFixtureUploadSummary,
  runFixtureUpload,
} from "./event-pipeline-v2-fixture-upload.mjs";

describe("Event Pipeline V2 fixture upload", () => {
  it("refuses hosted writes without explicit approval", async () => {
    await expect(
      runFixtureUpload({
        env: validEnv(),
        all: true,
      }),
    ).rejects.toThrow("fixture_upload_requires_allow_hosted_write");
  });

  it("uploads all fixture cases through collector APIs", async () => {
    const calls = [];
    const result = await runFixtureUpload({
      env: validEnv(),
      all: true,
      allowHostedWrite: true,
      now: new Date("2026-06-04T08:00:00.000Z"),
      fetchImpl: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return jsonResponse({ ok: true, id: `${url.split("/").at(-1)}-${calls.length}` });
      },
    });

    expect(result.kind).toBe("uploaded");
    expect(result.caseCount).toBe(8);
    expect(result.totals).toMatchObject({
      sourceRuns: 8,
      articleSnapshots: 8,
      eventDrafts: 12,
      excludedArticles: 1,
    });
    expect(calls.some((call) => call.url.endsWith("/api/collector/event-draft")))
      .toBe(true);
    expect(
      calls.some((call) => call.url.endsWith("/api/collector/excluded-article")),
    ).toBe(true);

    const qrDraft = calls.find(
      (call) =>
        call.url.endsWith("/api/collector/event-draft") &&
        call.body.payload.articleUrl === "https://mp.weixin.qq.com/s/qr-poster-fixture",
    );
    expect(qrDraft.body.payload).toMatchObject({
      triageDecision: "possible_public_activity",
      triageAction: "review",
      registrationQrAssetId: "asset-qr-registration-poster-qr",
      posterAssetId: "asset-qr-registration-poster-poster",
    });
    expect(qrDraft.body.payload.signals).toEqual(
      expect.arrayContaining(["qr_registration", "fixture_data"]),
    );

    const officialVisit = calls.find((call) =>
      call.url.endsWith("/api/collector/excluded-article"),
    );
    expect(officialVisit.body.payload).toMatchObject({
      triageDecision: "official_visit",
      triageAction: "exclude",
      exclusionReason: "not open to ordinary attendees",
    });
  });

  it("refuses production fixture uploads without the public fixture data flag", async () => {
    await expect(
      runFixtureUpload({
        env: productionEnv(),
        caseId: "qr-registration-poster",
        allowHostedWrite: true,
      }),
    ).rejects.toThrow("fixture_upload_refuses_production_public_catalog");
  });

  it("does not turn expected resolution metadata into duplicate drafts", async () => {
    const calls = [];

    await runFixtureUpload({
      env: validEnv(),
      caseId: "beiping-beer-festival",
      allowHostedWrite: true,
      now: new Date("2026-06-04T08:00:00.000Z"),
      fetchImpl: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return jsonResponse({ ok: true, id: `${url.split("/").at(-1)}-${calls.length}` });
      },
    });

    const beipingDraft = calls.find((call) =>
      call.url.endsWith("/api/collector/event-draft"),
    );
    expect(beipingDraft.body.payload.signals).toContain("fixture_data");
    expect(beipingDraft.body.payload.signals).not.toContain("possible_duplicate");
    expect(beipingDraft.body.payload).not.toHaveProperty("resolutionDecision");
  });

  it("allows explicit public fixture data mode for non-production fixtures", async () => {
    const calls = [];

    await runFixtureUpload({
      env: validEnv(),
      caseId: "qr-registration-poster",
      allowHostedWrite: true,
      allowPublicFixtureData: true,
      now: new Date("2026-06-04T08:00:00.000Z"),
      fetchImpl: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return jsonResponse({ ok: true, id: `${url.split("/").at(-1)}-${calls.length}` });
      },
    });

    const draft = calls.find((call) =>
      call.url.endsWith("/api/collector/event-draft"),
    );
    expect(draft.body.payload).toMatchObject({
      triageDecision: "public_activity",
    });
    expect(draft.body.payload.signals).toEqual(
      expect.arrayContaining(["qr_registration", "fixture_data"]),
    );
  });

  it("formats summaries without collector secrets", () => {
    const summary = formatFixtureUploadSummary({
      kind: "uploaded",
      caseCount: 2,
      totals: {
        sourceRuns: 2,
        articleSnapshots: 2,
        evidenceAssets: 3,
        eventDrafts: 2,
        excludedArticles: 0,
      },
      cases: [],
    });

    expect(summary).toContain("Fixture upload kind=uploaded cases=2");
    expect(summary).toContain("drafts=2");
    expect(summary).not.toContain("collector-secret");
  });
});

function validEnv() {
  return {
    COLLECTOR_BASE_URL: "https://activities.example",
    COLLECTOR_API_KEY: "collector-secret",
    COLLECTOR_ID: "home-1",
  };
}

function productionEnv() {
  return {
    COLLECTOR_BASE_URL: "https://local-activities.vercel.app",
    COLLECTOR_API_KEY: "collector-secret",
    COLLECTOR_ID: "home-1",
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}
