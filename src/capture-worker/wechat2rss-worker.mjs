import { createCaptureFailureResult } from "../capture/article-bundle.mjs";
import { createWechat2RssArticleBundle } from "../capture/source-adapters.mjs";
import { deriveWechat2RssHealth } from "../collector/source-providers/wechat2rss/index.mjs";
import {
  buildArticleBundleFiles,
  edgePayloadFromManifest,
} from "./bundle-files.mjs";
import { hydrateArticleBundleImages } from "./image-hydration.mjs";

const defaultMode = "production";
const defaultLookbackDays = 7;

export async function runWechat2RssCaptureOnce({
  wechat2rss,
  supabase,
  idempotency = supabase,
  now = new Date(),
  mode = defaultMode,
  dryRun = true,
  lookbackDays = defaultLookbackDays,
  limit,
  fetchImpl = fetch,
  hydrateImages = !dryRun,
  maxHydratedImages,
} = {}) {
  if (!wechat2rss) throw new Error("wechat2rss_client_required");
  if (!idempotency) throw new Error("idempotency_adapter_required");
  if (!dryRun && !supabase) throw new Error("supabase_adapter_required");
  if (limit !== undefined && !isPositiveInteger(limit)) {
    throw new Error(`invalid_limit:${limit}`);
  }

  let logins;
  try {
    logins = await wechat2rss.listLogins();
  } catch (error) {
    return sourceFailureResult({
      reason: mapRuntimeErrorToCaptureFailureReason(error),
      message: errorMessage(error),
      diagnostics: [{ key: "wechat2rss_error", value: errorMessage(error) }],
      mode,
      dryRun,
    });
  }

  const health = deriveWechat2RssHealth(logins);
  if (health.failureReason) {
    return sourceFailureResult({
      reason: health.failureReason,
      message: "Wechat2RSS source is not healthy enough to capture articles.",
      diagnostics: [
        { key: "wechat2rss_health_status", value: health.healthStatus },
        { key: "wechat2rss_accounts", value: logins.accounts },
      ],
      mode,
      dryRun,
    });
  }

  let articles;
  const after = formatWechat2RssDate(
    new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000),
  );
  try {
    const response = await wechat2rss.queryArticles({ after, content: true });
    articles = response.articles ?? [];
  } catch (error) {
    return sourceFailureResult({
      reason: mapRuntimeErrorToCaptureFailureReason(error),
      message: errorMessage(error),
      diagnostics: [{ key: "wechat2rss_error", value: errorMessage(error) }],
      mode,
      dryRun,
    });
  }

  const result = {
    ok: true,
    mode,
    dryRun,
    after,
    ...(limit !== undefined ? { limit } : {}),
    checkedCount: articles.length,
    consideredCount: limit === undefined ? articles.length : Math.min(limit, articles.length),
    bundledCount: 0,
    uploadedCount: 0,
    triggeredCount: 0,
    skippedCount: 0,
    failureCount: 0,
    bundles: [],
    skipped: [],
    failures: [],
  };

  const consideredArticles = limit === undefined ? articles : articles.slice(0, limit);

  for (const article of consideredArticles) {
    try {
      const bundle = createWechat2RssArticleBundle({
        article,
        capturedAt: now.toISOString(),
      });
      const existing = await idempotency.findExistingBundle({
        sourceUrl: bundle.sourceUrl,
        contentHash: bundle.contentHash,
        mode,
      });
      if (existing) {
        result.skippedCount += 1;
        result.skipped.push({
          sourceUrl: bundle.sourceUrl,
          contentHash: bundle.contentHash,
          reason: "already_processed",
          existing,
        });
        continue;
      }

      const analysisBundle = hydrateImages
        ? await hydrateArticleBundleImages({
          bundle,
          fetchImpl,
          maxImages: maxHydratedImages,
        })
        : bundle;
      const bundleFiles = buildArticleBundleFiles({
        bundle: analysisBundle,
        mode,
      });
      const edgePayload = edgePayloadFromManifest({
        manifest: bundleFiles.manifest,
        storagePrefix: bundleFiles.storagePrefix,
      });
      result.bundledCount += 1;
      result.bundles.push({
        bundleId: bundleFiles.bundleId,
        sourceUrl: bundle.sourceUrl,
        contentHash: bundle.contentHash,
        sourceProvider: bundle.provider,
        storagePrefix: bundleFiles.storagePrefix,
        edgePayload,
      });

      if (!dryRun) {
        await supabase.uploadAndAnalyzeBundle(bundleFiles);
        result.uploadedCount += 1;
        result.triggeredCount += 1;
      }
    } catch (error) {
      result.failureCount += 1;
      result.failures.push({
        sourceUrl: article.url,
        reason: "browser_error",
        message: errorMessage(error),
      });
    }
  }

  if (result.failureCount > 0) result.ok = false;
  return result;
}

function sourceFailureResult({
  reason,
  message,
  diagnostics,
  mode,
  dryRun,
}) {
  const captureResult = createCaptureFailureResult({
    stage: "source_discovery",
    reason,
    message,
    retryable: true,
    diagnostics,
  });
  return {
    ok: false,
    mode,
    dryRun,
    checkedCount: 0,
    bundledCount: 0,
    uploadedCount: 0,
    triggeredCount: 0,
    skippedCount: 0,
    failureCount: 1,
    failure: captureResult.failure,
    bundles: [],
    skipped: [],
    failures: [captureResult.failure],
  };
}

function mapRuntimeErrorToCaptureFailureReason(error) {
  const message = errorMessage(error).toLowerCase();
  if (message.includes("401") || message.includes("403") || message.includes("login")) {
    return "login_required";
  }
  if (message.includes("captcha")) return "captcha_required";
  if (message.includes("404") || message.includes("not found")) return "not_found";
  if (message.includes("blocked") || message.includes("429")) return "fetch_blocked";
  return "source_unhealthy";
}

function formatWechat2RssDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
