import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateCapturedArticleBundle } from "../../capture/article-bundle.mjs";

export const privateCorpusManifestVersion = "event-pipeline-regression-corpus-v1";

export const privateCorpusLeakageMarkers = [
  "Expected action",
  "expected action",
  "expected_action",
  "Rationale",
  "rationale",
  "Review/exclusion reasons",
  "review exclusion reasons",
  "expectedAction",
  "expected_event",
  "expectedEvent",
  "expected_event_count",
  "expectedEventCount",
  "must_have_fields",
  "known_failure_type",
];

export async function exportPrivateCorpusCase({
  feedbackId,
  pipelineRunId,
  articleBundleId,
  outputDir = ".local/private-corpus",
  caseId,
  expected,
  store,
  now = new Date(),
} = {}) {
  if (!store) throw new Error("private_corpus_store_required");
  if (!feedbackId && !pipelineRunId && !articleBundleId) {
    throw new Error("private_corpus_source_id_required");
  }

  const feedback = feedbackId
    ? await requiredStoreRecord(
      store.getFeedbackById?.(feedbackId),
      `private_corpus_feedback_not_found:${feedbackId}`,
    )
    : undefined;
  const resolvedPipelineRunId = pipelineRunId ?? feedback?.pipelineRunId;
  const pipelineRun = resolvedPipelineRunId
    ? await requiredStoreRecord(
      store.getPipelineRunById?.(resolvedPipelineRunId),
      `private_corpus_pipeline_run_not_found:${resolvedPipelineRunId}`,
    )
    : undefined;
  const resolvedArticleBundleId =
    articleBundleId ?? feedback?.articleBundleId ?? pipelineRun?.articleBundleId;
  if (!resolvedArticleBundleId) {
    throw new Error("private_corpus_article_bundle_id_required");
  }

  const articleBundleRecord = await requiredStoreRecord(
    store.getArticleBundleById?.(resolvedArticleBundleId),
    `private_corpus_article_bundle_not_found:${resolvedArticleBundleId}`,
  );
  const bundle =
    articleBundleRecord.capturedBundle ?? articleBundleRecord.bundle;
  validateCapturedArticleBundle(bundle);

  const resolvedCaseId =
    clean(caseId) ??
    caseIdFromSource({ feedbackId, pipelineRunId: resolvedPipelineRunId, articleBundleId: resolvedArticleBundleId, bundle });
  if (!isSafeCaseId(resolvedCaseId)) {
    throw new Error(`private_corpus_case_id_invalid:${resolvedCaseId}`);
  }
  const labels = labelsForFeedback(feedback);
  const expectedBehavior = normalizeExpected(
    expected ??
      expectedFromFeedback(feedback) ??
      expectedFromPipelineRun(pipelineRun),
  );
  const caseDir = path.join(outputDir, resolvedCaseId);
  await mkdir(path.join(caseDir, "assets"), { recursive: true });

  const capturedBundle = await materializeBundleAssets({
    bundle,
    caseDir,
  });
  assertNoPrivateCorpusLabelLeakage(capturedBundle);

  const caseMeta = removeUndefined({
    id: resolvedCaseId,
    labels,
    source: {
      type: "captured_bundle",
      provider: bundle.provider,
      sourceName: bundle.sourceName,
      url: bundle.sourceUrl,
      publishedAt: bundle.publishedAt,
    },
    rationale: rationaleForExport({ feedback, pipelineRun, expected: expectedBehavior }),
    capture: {
      capturedAt: bundle.capturedAt,
      assetCount: capturedBundle.images?.length ?? 0,
      imageCount: capturedBundle.images?.length ?? 0,
      source: "private corpus builder",
      privateRawCorpus: true,
    },
    expected_action: expectedBehavior.action,
    expected_event_count: expectedBehavior.eventCount,
    must_have_fields: expectedBehavior.mustHaveFields,
    known_failure_type: feedback?.feedbackType,
    source_name: bundle.sourceName,
    source_url: bundle.sourceUrl,
    created_from_feedback_id: feedbackId,
    created_from_pipeline_run_id: resolvedPipelineRunId,
    created_from_article_bundle_id: resolvedArticleBundleId,
    created_at: now.toISOString(),
  });

  await writeJson(path.join(caseDir, "case.json"), caseMeta);
  await writeJson(path.join(caseDir, "captured-bundle.json"), capturedBundle);
  await upsertManifest({
    outputDir,
    entry: {
      id: resolvedCaseId,
      labels,
      sourceUrl: bundle.sourceUrl,
      createdAt: now.toISOString(),
    },
  });

  return {
    caseId: resolvedCaseId,
    caseDir,
    manifestPath: path.join(outputDir, "manifest.json"),
  };
}

export function assertNoPrivateCorpusLabelLeakage(value) {
  const text = normalizeLeakageText(JSON.stringify(value));
  for (const marker of privateCorpusLeakageMarkers) {
    if (text.includes(normalizeLeakageText(marker))) {
      throw new Error(`private_corpus_model_input_leakage:${marker}`);
    }
  }
}

async function materializeBundleAssets({ bundle, caseDir }) {
  const images = [];
  for (const [index, image] of (bundle.images ?? []).entries()) {
    images.push(await materializeImageAsset({ image, caseDir, index }));
  }
  return removeUndefined({
    ...bundle,
    images,
  });
}

async function materializeImageAsset({ image, caseDir, index }) {
  const bytes = imageBytes(image);
  const id = clean(image.id) ?? `image-${index + 1}`;
  const contentType = clean(image.contentType);
  const extension = extensionForContentType(contentType) ?? "bin";
  const fileName = `${safeFileName(id)}.${extension}`;
  const assetPath = `assets/${fileName}`;
  if (bytes) {
    await writeFile(path.join(caseDir, assetPath), bytes);
  }
  return removeUndefined({
    ...image,
    body: undefined,
    bytes: undefined,
    dataUrl: undefined,
    path: bytes ? assetPath : image.path,
    contentType,
  });
}

function imageBytes(image) {
  if (image.body) return Buffer.from(image.body);
  if (image.bytes) return Buffer.from(image.bytes);
  const dataUrl = clean(image.dataUrl);
  if (!dataUrl) return undefined;
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return undefined;
  return Buffer.from(match[2], "base64");
}

function expectedFromFeedback(feedback) {
  if (!feedback) return undefined;
  if (["not_event", "not_public"].includes(feedback.feedbackType)) {
    return { action: "exclude", eventCount: 0 };
  }
  if (feedback.feedbackType === "other") {
    return { action: "review", eventCount: 1 };
  }
  return { action: "extract", eventCount: 1 };
}

function expectedFromPipelineRun(pipelineRun) {
  if (!pipelineRun) return { action: "review", eventCount: 1 };
  const decision = String(pipelineRun.decision ?? "").toLowerCase();
  if (["published", "auto_published", "public_activity"].includes(decision)) {
    return { action: "extract", eventCount: 1 };
  }
  if (["excluded", "not_event", "non_event"].includes(decision)) {
    return { action: "exclude", eventCount: 0 };
  }
  return { action: "review", eventCount: 1 };
}

function normalizeExpected(expected = {}) {
  const action = clean(expected.action ?? expected.expected_action ?? expected.expectedAction) ?? "review";
  const eventCount = Number(
    expected.eventCount ?? expected.expected_event_count ?? expected.expectedEventCount ?? 1,
  );
  if (!["extract", "exclude", "review", "capture_failure"].includes(action)) {
    throw new Error(`private_corpus_expected_action_invalid:${action}`);
  }
  if (!Number.isInteger(eventCount) || eventCount < 0) {
    throw new Error("private_corpus_expected_event_count_invalid");
  }
  return removeUndefined({
    action,
    eventCount,
    mustHaveFields: Array.isArray(expected.mustHaveFields)
      ? expected.mustHaveFields
      : expected.must_have_fields,
  });
}

function labelsForFeedback(feedback) {
  const type = feedback?.feedbackType;
  const label = {
    missing_qr: "qr_registration",
    missing_registration: "registration_required",
    duplicate_event: "duplicate_or_update",
    not_event: "generic_not_event",
    not_public: "not_general_public",
    should_publish: "ordinary_public_event",
    missing_event: "ordinary_public_event",
    wrong_time: "ordinary_public_event",
    wrong_location: "ordinary_public_event",
    bad_summary: "ordinary_public_event",
    bad_category_or_tags: "ordinary_public_event",
    other: "information_sparse_requires_review",
  }[type] ?? "ordinary_public_event";
  return [label];
}

function rationaleForExport({ feedback, pipelineRun, expected }) {
  if (feedback?.reason) return feedback.reason;
  if (pipelineRun?.reason) return pipelineRun.reason;
  return `Private corpus export expected ${expected.action}.`;
}

async function upsertManifest({ outputDir, entry }) {
  await mkdir(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, "manifest.json");
  const manifest = await readJsonIfExists(manifestPath) ?? {
    version: privateCorpusManifestVersion,
    description: "Private raw corpus generated from local pipeline artifacts and feedback.",
    cases: [],
    requiredCoverageLabels: [],
    private: true,
  };
  if (manifest.version !== privateCorpusManifestVersion) {
    throw new Error("private_corpus_manifest_version_invalid");
  }
  const cases = [
    ...manifest.cases.filter((item) => item.id !== entry.id),
    entry,
  ];
  const requiredCoverageLabels = [
    ...new Set(cases.flatMap((item) => item.labels ?? [])),
  ].sort();
  await writeJson(manifestPath, {
    ...manifest,
    cases,
    requiredCoverageLabels,
  });
}

async function requiredStoreRecord(promise, errorCode) {
  if (!promise) throw new Error(errorCode);
  const value = await promise;
  if (!value) throw new Error(errorCode);
  return value;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function caseIdFromSource({ feedbackId, pipelineRunId, articleBundleId, bundle }) {
  if (feedbackId) return `wechat-event-${slug(feedbackId)}`;
  if (pipelineRunId) return `wechat-event-${slug(pipelineRunId)}`;
  if (articleBundleId) return `wechat-event-${slug(articleBundleId)}`;
  return `wechat-event-${hashText(bundle.sourceUrl).slice(0, 10)}`;
}

function extensionForContentType(contentType) {
  const value = clean(contentType)?.toLowerCase();
  if (value === "image/jpeg" || value === "image/jpg") return "jpg";
  if (value === "image/png") return "png";
  if (value === "image/webp") return "webp";
  if (value === "image/gif") return "gif";
  return undefined;
}

function safeFileName(value) {
  return slug(value).slice(0, 80) || "asset";
}

function isSafeCaseId(value) {
  return Boolean(value && value === slug(value));
}

function normalizeLeakageText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function slug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hashText(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function removeUndefined(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}
