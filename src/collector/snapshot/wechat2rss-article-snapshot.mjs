import { articleBundleToExtractionInput } from "../../capture/article-bundle.mjs";
import { createWechat2RssArticleBundle } from "../../capture/source-adapters.mjs";
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
  const articleBundle = createWechat2RssArticleBundle({
    article,
    capturedAt: observedAt,
  });
  const extractionInput = articleBundleToExtractionInput(articleBundle);
  const imageCandidates = extractImageCandidatesFromHtml(article.contentHtml, {
    articleUrl: article.url,
  });
  const evidenceAssets = storeImages
    ? await buildImageEvidenceAssetEnvelopes({
        collectorId,
        runId,
        observedAt,
        articleUrl: article.url,
        imageCandidates,
        storeImages,
        fetchImpl,
        putPublicAsset,
      })
    : extractionInput.evidenceAssets.map((payload) =>
        envelope({ collectorId, runId, observedAt, payload }),
      );
  const evidencePayloads = evidenceAssets.map((asset) => asset.payload);
  const articleSnapshotPayload = {
    ...extractionInput.articleSnapshot,
    captureMode: captureModeForImageEvidence({
      visibleText: extractionInput.articleSnapshot.visibleText,
      evidenceAssets,
    }),
    screenshotAssetId: evidenceAssets.find(
      (asset) => asset.payload.role === "screenshot",
    )?.payload.assetId,
    evidenceAssetIds: evidencePayloads.map((asset) => asset.assetId),
  };

  return {
    articleBundle,
    articleSnapshot: {
      collectorId,
      runId,
      observedAt,
      payloadVersion: collectorPayloadVersion,
      payload: articleSnapshotPayload,
    },
    imageCandidates,
    evidenceAssets,
  };
}

function envelope({ collectorId, runId, observedAt, payload }) {
  return {
    collectorId,
    runId,
    observedAt,
    payloadVersion: collectorPayloadVersion,
    payload,
  };
}
