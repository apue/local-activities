import { createCollectorHeaders } from "../../../scripts/collector-fixture-run.mjs";
import { runLlmExtractionOnce } from "../../../scripts/llm-extractor.mjs";
import {
  buildWechat2RssArticleSnapshotArtifact,
} from "../snapshot/wechat2rss-article-snapshot.mjs";
import {
  uploadArticleSnapshots,
  uploadEvidenceAssets,
  uploadExtractionResults,
  uploadSourceRun,
} from "../upload-client/index.mjs";
import {
  createWechat2RssClient,
  deriveWechat2RssHealth,
  readWechat2RssConfig,
} from "../source-providers/wechat2rss/index.mjs";

const collectorPayloadVersion = "2026-05-collector-v1";

export async function runWechat2RssSyncOnce({
  env = process.env,
  fetchImpl = fetch,
  putPublicAsset,
  now = new Date(),
  runId = createRunId(now),
  extract = false,
}) {
  const config = readWechat2RssSyncConfig(env);
  if (!config.ok) {
    return {
      kind: "failed",
      error: "missing_wechat2rss_sync_config",
      missing: config.missing,
    };
  }

  const observedAt = now.toISOString();
  const startedAt = new Date(now.getTime() - 30_000).toISOString();
  const client = createWechat2RssClient({
    baseUrl: config.wechat2rss.baseUrl,
    token: config.wechat2rss.token,
    fetchImpl,
  });
  const after = formatDate(
    new Date(
      now.getTime() - config.wechat2rss.lookbackDays * 24 * 60 * 60 * 1000,
    ),
  );

  let logins;
  try {
    logins = await client.listLogins();
  } catch (error) {
    const failureReason = mapSyncErrorToFailureReason(error);
    await uploadSourceRun({
      config,
      fetchImpl,
      envelope: sourceRunEnvelope({
        collectorId: config.collectorId,
        runId,
        observedAt,
        payload: {
          status: "failed",
          startedAt,
          finishedAt: observedAt,
          checkedUrlCount: 0,
          articleCount: 0,
          draftCount: 0,
          failureCount: 1,
          failureReason,
          diagnostics: diagnosticEntries({
            provider: "wechat2rss",
            stage: "login_health",
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      }),
    });
    return {
      kind: "failed",
      runId,
      failureReason,
      uploadedArticleCount: 0,
    };
  }

  const health = deriveWechat2RssHealth(logins);
  if (health.failureReason) {
    await uploadSourceRun({
      config,
      fetchImpl,
      envelope: sourceRunEnvelope({
        collectorId: config.collectorId,
        runId,
        observedAt,
        payload: {
          status: "failed",
          startedAt,
          finishedAt: observedAt,
          checkedUrlCount: 0,
          articleCount: 0,
          draftCount: 0,
          failureCount: 1,
          failureReason: health.failureReason,
          diagnostics: diagnosticEntries({
            provider: "wechat2rss",
            stage: "login_health",
            accountCount: String(logins.accounts.length),
          }),
        },
      }),
    });
    return {
      kind: "attention_needed",
      runId,
      failureReason: health.failureReason,
      uploadedArticleCount: 0,
    };
  }

  const query = await client.queryArticles({ after, content: extract });
  const articles = dedupeArticles(query.articles);
  const articleArtifacts = [];
  for (const article of articles) {
    articleArtifacts.push(
      await buildWechat2RssArticleSnapshotArtifact({
        collectorId: config.collectorId,
        runId,
        observedAt,
        article,
        fetchImpl,
        putPublicAsset,
        storeImages: config.assetStorageEnabled || Boolean(putPublicAsset),
      }),
    );
  }
  const articleEnvelopes = articleArtifacts.map(
    (artifact) => artifact.articleSnapshot,
  );
  const extractionResults = [];
  if (extract) {
    for (const artifact of articleArtifacts) {
      extractionResults.push(
        await runLlmExtractionOnce({
          env,
          articleSnapshot: artifact.articleSnapshot.payload,
          evidenceAssets: artifact.evidenceAssets.map(
            (envelope) => envelope.payload,
          ),
          fetchImpl,
          now,
          runId,
          upload: false,
        }),
      );
    }
  }
  const extractionCounts = summarizeExtractionResults(extractionResults);
  const sourceRun = await uploadSourceRun({
    config,
    fetchImpl,
    envelope: sourceRunEnvelope({
      collectorId: config.collectorId,
      runId,
      observedAt,
      payload: {
        status: extractionCounts.failureCount > 0 ? "partial" : "success",
        startedAt,
        finishedAt: observedAt,
        checkedUrlCount: articles.length,
        articleCount: articles.length,
        draftCount: extractionCounts.eventDraftCount,
        failureCount: extractionCounts.failureCount,
        failureReason: extractionCounts.failureReason,
        diagnostics: diagnosticEntries({
          provider: "wechat2rss",
          after,
          accountCount: String(logins.accounts.length),
          extractionEnabled: extract ? "true" : "false",
        }),
      },
    }),
  });

  const uploadedArticleSnapshotIds = await uploadArticleSnapshots({
    config,
    fetchImpl,
    articleEnvelopes,
  });
  const uploadedSourceEvidence = await uploadEvidenceAssets({
    config,
    fetchImpl,
    evidenceAssets: articleArtifacts.flatMap(
      (artifact) => artifact.evidenceAssets,
    ),
  });
  const uploadedExtraction = await uploadExtractionResults({
    config,
    fetchImpl,
    extractionResults,
  });
  const uploadedEvidenceAssetCount =
    (uploadedSourceEvidence.uploadedEvidenceAssetCount ?? 0) +
    (uploadedExtraction.uploadedEvidenceAssetCount ?? 0);
  const uploadedEvidenceAssetSummary =
    uploadedEvidenceAssetCount > 0 || extractionResults.length
      ? { uploadedEvidenceAssetCount }
      : {};

  return {
    kind: "uploaded",
    runId,
    sourceRunId: sourceRun.id,
    articleCount: articles.length,
    uploadedArticleCount: uploadedArticleSnapshotIds.length,
    uploadedArticleSnapshotIds,
    ...uploadedExtraction,
    ...uploadedEvidenceAssetSummary,
    after,
  };
}

export function readWechat2RssSyncConfig(env) {
  const collectorBaseUrl = normalizeBaseUrl(
    env.COLLECTOR_BASE_URL ?? env.APP_BASE_URL ?? "",
  );
  const collectorApiKey = env.COLLECTOR_API_KEY?.trim();
  const collectorId = env.COLLECTOR_ID?.trim();
  const missing = [];
  if (!collectorBaseUrl) missing.push("COLLECTOR_BASE_URL");
  if (!collectorApiKey) missing.push("COLLECTOR_API_KEY");
  if (!collectorId) missing.push("COLLECTOR_ID");

  const wechat2rss = readWechat2RssConfig(env);
  if (!wechat2rss.ok) missing.push(...wechat2rss.missing);

  if (missing.length > 0) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    collectorBaseUrl,
    collectorId,
    collectorApiKey,
    headers: createCollectorHeaders({
      collectorId,
      collectorApiKey,
    }),
    wechat2rss,
    assetStorageEnabled: Boolean(env.BLOB_READ_WRITE_TOKEN?.trim()),
  };
}

export function formatWechat2RssSyncSummary(result) {
  const parts = ["Wechat2RSS sync", `kind=${result.kind}`];
  if (result.runId) parts.push(`run=${result.runId}`);
  if (result.failureReason) parts.push(`failure=${result.failureReason}`);
  if (result.articleCount != null) parts.push(`articles=${result.articleCount}`);
  if (result.uploadedArticleCount != null) {
    parts.push(`uploaded=${result.uploadedArticleCount}`);
  }
  if (result.uploadedEventDraftCount != null) {
    parts.push(`drafts=${result.uploadedEventDraftCount}`);
  }
  if (result.uploadedCollectorFailureCount != null) {
    parts.push(`extractFailures=${result.uploadedCollectorFailureCount}`);
  }
  if (result.after) parts.push(`after=${result.after}`);
  if (result.missing?.length) parts.push(`missing=${result.missing.join(",")}`);
  return parts.join(" ");
}

export function sourceRunEnvelope({ collectorId, runId, observedAt, payload }) {
  return {
    collectorId,
    runId,
    observedAt,
    payloadVersion: collectorPayloadVersion,
    payload,
  };
}

export function summarizeExtractionResults(extractionResults) {
  const eventDraftCount = extractionResults.reduce(
    (count, result) => count + (result.eventDrafts?.length ?? 0),
    0,
  );
  const failureReasons = extractionResults.flatMap((result) =>
    (result.failures ?? []).map((failure) => failure.payload.reason),
  );
  const failureCount = failureReasons.length;
  return {
    eventDraftCount,
    failureCount,
    failureReason: failureReasons[0],
  };
}

export function dedupeArticles(articles) {
  const seen = new Set();
  const unique = [];
  for (const article of articles) {
    const key = `${article.url}:${article.contentHash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(article);
  }
  return unique;
}

export function diagnosticEntries(values) {
  return Object.entries(values)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => ({ key, value: String(value).slice(0, 2_000) }));
}

function mapSyncErrorToFailureReason(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("401") || message.includes("403")) return "login_required";
  if (message.includes("network")) return "fetch_timeout";
  return "fetch_blocked";
}

function createRunId(now) {
  return `wechat2rss-${now.toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
}

function formatDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
}

function normalizeBaseUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}
