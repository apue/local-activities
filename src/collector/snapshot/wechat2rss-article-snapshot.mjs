import { createHash } from "node:crypto";

import {
  buildImageEvidenceAssetEnvelopes,
  captureModeForImageEvidence,
  extractImageCandidatesFromHtml,
} from "../evidence/wechat-images.mjs";

const collectorPayloadVersion = "2026-05-collector-v1";

export async function buildWechat2RssArticleSnapshotArtifact({
  collectorId,
  runId,
  observedAt,
  article,
  fetchImpl,
  putPublicAsset,
  storeImages,
}) {
  const visibleText = [article.title, article.summary, article.contentText]
    .filter(Boolean)
    .join("\n");
  const imageCandidates = extractImageCandidatesFromHtml(article.contentHtml, {
    articleUrl: article.url,
  });
  const evidenceAssets = await buildImageEvidenceAssetEnvelopes({
    collectorId,
    runId,
    observedAt,
    articleUrl: article.url,
    imageCandidates,
    storeImages,
    fetchImpl,
    putPublicAsset,
  });

  return {
    articleSnapshot: {
      collectorId,
      runId,
      observedAt,
      payloadVersion: collectorPayloadVersion,
      payload: {
        sourceName: article.sourceName,
        canonicalUrl: article.url,
        finalUrl: article.url,
        title: article.title,
        authorName: article.sourceName,
        publishedAt: article.publishedAt,
        capturedAt: observedAt,
        languageHints: ["zh", "en"],
        captureMode: captureModeForImageEvidence({
          visibleText,
          evidenceAssets,
        }),
        visibleText: visibleText || undefined,
        textHash: visibleText ? hashText(visibleText) : undefined,
        screenshotAssetId: evidenceAssets.find(
          (asset) => asset.payload.role === "screenshot",
        )?.payload.assetId,
        evidenceAssetIds: evidenceAssets.map(
          (asset) => asset.payload.assetId,
        ),
        contentHash: article.contentHash,
      },
    },
    imageCandidates,
    evidenceAssets,
  };
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}
