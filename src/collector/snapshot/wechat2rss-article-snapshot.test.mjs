import { describe, expect, it } from "vitest";

import {
  articleSnapshotSchema,
  collectorEnvelopeSchema,
  evidenceAssetSchema,
} from "../../contracts/collector";
import { buildWechat2RssArticleSnapshotArtifact } from "./wechat2rss-article-snapshot.mjs";

describe("Wechat2RSS article snapshot builder", () => {
  it("builds a collector article snapshot with poster and QR evidence envelopes", async () => {
    const artifact = await buildWechat2RssArticleSnapshotArtifact({
      collectorId: "collector-1",
      runId: "run-1",
      observedAt: "2026-06-03T08:00:00.000Z",
      article: {
        title: "周末文化活动",
        summary: "扫码报名",
        contentText: "6月6日 14:00 北京文化中心",
        contentHtml: `
          <p>扫码报名</p>
          <img data-src="https://mmbiz.qpic.cn/poster.jpg" alt="活动海报" width="900" height="1200" />
          <img data-src="https://mmbiz.qpic.cn/register-qr.jpg" alt="报名二维码" />
        `,
        sourceName: "Embassy Culture",
        url: "https://mp.weixin.qq.com/s/activity",
        publishedAt: "2026-06-01T10:00:00.000Z",
        contentHash: "hash-1",
      },
      storeImages: false,
    });

    expect(() =>
      collectorEnvelopeSchema(articleSnapshotSchema).parse(
        artifact.articleSnapshot,
      ),
    ).not.toThrow();
    for (const evidence of artifact.evidenceAssets) {
      expect(() =>
        collectorEnvelopeSchema(evidenceAssetSchema).parse(evidence),
      ).not.toThrow();
    }
    expect(artifact.articleSnapshot.payload).toMatchObject({
      canonicalUrl: "https://mp.weixin.qq.com/s/activity",
      finalUrl: "https://mp.weixin.qq.com/s/activity",
      title: "周末文化活动",
      captureMode: "image_with_qr_registration",
      sourceName: "Embassy Culture",
    });
    expect(artifact.articleSnapshot.payload.evidenceAssetIds).toHaveLength(2);
    expect(artifact.evidenceAssets.map((asset) => asset.payload.role)).toEqual([
      "poster",
      "qr",
    ]);
  });
});
