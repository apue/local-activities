import { describe, expect, it } from "vitest";

import {
  postCollectorJson,
  uploadArticleSnapshots,
  uploadEvidenceAssets,
  uploadExtractionResults,
  uploadSourceRun,
} from "./index.mjs";

const config = {
  collectorBaseUrl: "https://app.example.com",
  headers: {
    authorization: "Bearer test",
  },
};

describe("collector upload client", () => {
  it("posts JSON through collector API routes and returns parsed responses", async () => {
    const calls = [];
    const result = await postCollectorJson({
      baseUrl: config.collectorBaseUrl,
      path: "/api/collector/source-run",
      headers: config.headers,
      body: { collectorId: "collector-1" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return Response.json({ ok: true, id: "source-run-1" });
      },
    });

    expect(result).toEqual({ ok: true, id: "source-run-1" });
    expect(calls).toEqual([
      {
        url: "https://app.example.com/api/collector/source-run",
        init: {
          method: "POST",
          headers: config.headers,
          body: JSON.stringify({ collectorId: "collector-1" }),
        },
      },
    ]);
  });

  it("surfaces collector upload failures with the route path", async () => {
    await expect(
      postCollectorJson({
        baseUrl: config.collectorBaseUrl,
        path: "/api/collector/article-snapshot",
        headers: config.headers,
        body: {},
        fetchImpl: async () => Response.json({ ok: false }, { status: 400 }),
      }),
    ).rejects.toThrow(
      "collector_upload_failed:/api/collector/article-snapshot:400",
    );
  });

  it("wraps source run, snapshot, evidence, and extraction uploads", async () => {
    const paths = [];
    const fetchImpl = async (url) => {
      paths.push(new URL(url).pathname);
      return Response.json({ ok: true, id: `id-${paths.length}` });
    };

    const sourceRun = await uploadSourceRun({
      config,
      fetchImpl,
      envelope: { collectorId: "collector-1" },
    });
    const articleIds = await uploadArticleSnapshots({
      config,
      fetchImpl,
      articleEnvelopes: [{ payload: { title: "a" } }],
    });
    const evidence = await uploadEvidenceAssets({
      config,
      fetchImpl,
      evidenceAssets: [{ payload: { assetId: "asset-1" } }],
    });
    const extraction = await uploadExtractionResults({
      config,
      fetchImpl,
      extractionResults: [
        {
          evidenceAssets: [{ payload: { assetId: "asset-2" } }],
          eventDrafts: [{ payload: { title: "event" } }],
          failures: [{ payload: { reason: "not_public_event" } }],
        },
      ],
    });

    expect(sourceRun.id).toBe("id-1");
    expect(articleIds).toEqual(["id-2"]);
    expect(evidence).toEqual({ uploadedEvidenceAssetCount: 1 });
    expect(extraction).toEqual({
      uploadedEvidenceAssetCount: 1,
      uploadedEventDraftCount: 1,
      uploadedCollectorFailureCount: 1,
    });
    expect(paths).toEqual([
      "/api/collector/source-run",
      "/api/collector/article-snapshot",
      "/api/collector/evidence-asset",
      "/api/collector/evidence-asset",
      "/api/collector/event-draft",
      "/api/collector/failure",
    ]);
  });
});
