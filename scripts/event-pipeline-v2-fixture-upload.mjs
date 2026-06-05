#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { createCollectorHeaders } from "./collector-fixture-run.mjs";
import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";
import {
  loadFixtureCase,
  parseFixtureArgs,
  requiredFixtureCases,
} from "./event-pipeline-v2-fixtures.mjs";

const payloadVersion = "2026-05-collector-v1";

export async function runFixtureUpload({
  env = process.env,
  fetchImpl = fetch,
  caseId,
  all = false,
  allowHostedWrite = false,
  allowPublicFixtureData = false,
  now = new Date(),
} = {}) {
  if (!allowHostedWrite) {
    throw new Error("fixture_upload_requires_allow_hosted_write");
  }

  const config = readCollectorUploadConfig(env);
  const uploadEnvironment = classifyFixtureUploadEnvironment(env, config.baseUrl);
  if (uploadEnvironment === "production" && !allowPublicFixtureData) {
    throw new Error("fixture_upload_refuses_production_public_catalog");
  }
  const caseIds = all ? requiredFixtureCases : [caseId].filter(Boolean);
  if (!caseIds.length) throw new Error("fixture_case_required");

  const cases = [];
  const totals = {
    sourceRuns: 0,
    articleSnapshots: 0,
    evidenceAssets: 0,
    eventDrafts: 0,
    excludedArticles: 0,
  };

  for (const id of caseIds) {
    const fixture = await loadFixtureCase({ caseId: id });
    const built = buildFixtureUploadCase({
      fixture,
      collectorId: config.collectorId,
      now,
      uploadEnvironment,
      publicCatalogEnabled: allowPublicFixtureData,
    });
    const uploaded = await uploadBuiltFixture({
      config,
      fetchImpl,
      built,
    });
    cases.push(uploaded);
    totals.sourceRuns += uploaded.uploaded.sourceRun ? 1 : 0;
    totals.articleSnapshots += uploaded.uploaded.articleSnapshot ? 1 : 0;
    totals.evidenceAssets += uploaded.uploaded.evidenceAssets;
    totals.eventDrafts += uploaded.uploaded.eventDrafts;
    totals.excludedArticles += uploaded.uploaded.excludedArticles;
  }

  return {
    kind: "uploaded",
    caseCount: cases.length,
    environment: uploadEnvironment,
    publicCatalogEnabled: allowPublicFixtureData,
    totals,
    cases,
  };
}

export function formatFixtureUploadSummary(result) {
  return [
    `Fixture upload kind=${result.kind}`,
    `cases=${result.caseCount}`,
    `sourceRuns=${result.totals.sourceRuns}`,
    `snapshots=${result.totals.articleSnapshots}`,
    `evidence=${result.totals.evidenceAssets}`,
    `drafts=${result.totals.eventDrafts}`,
    `excluded=${result.totals.excludedArticles}`,
  ].join(" ");
}

function readCollectorUploadConfig(env) {
  const baseUrl = normalizeBaseUrl(env.COLLECTOR_BASE_URL ?? env.APP_BASE_URL ?? "");
  const collectorId = env.COLLECTOR_ID?.trim();
  const collectorApiKey = env.COLLECTOR_API_KEY?.trim();
  if (!baseUrl) throw new Error("missing_collector_base_url");
  if (!collectorId) throw new Error("missing_collector_id");
  if (!collectorApiKey) throw new Error("missing_collector_api_key");

  return {
    baseUrl,
    collectorId,
    headers: createCollectorHeaders({ collectorId, collectorApiKey }),
  };
}

function classifyFixtureUploadEnvironment(env, baseUrl) {
  const explicitTarget = (
    env.FIXTURE_UPLOAD_TARGET ??
    env.FIXTURE_UPLOAD_ENV ??
    env.VERCEL_ENV ??
    ""
  )
    .trim()
    .toLowerCase();
  if (explicitTarget === "production") return "production";
  if (["preview", "staging", "development", "local", "test"].includes(explicitTarget)) {
    return explicitTarget;
  }

  const hostname = new URL(baseUrl).hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1") return "local";
  if (hostname === "local-activities.vercel.app") return "production";
  if (hostname === "activities.example") return "test";
  if (hostname.endsWith(".vercel.app")) return "preview";
  return "hosted";
}

function buildFixtureUploadCase({
  fixture,
  collectorId,
  now,
  uploadEnvironment,
  publicCatalogEnabled,
}) {
  const files = fixture.files;
  const observedAt = now.toISOString();
  const runId = `fixture-${fixture.caseId}-${now
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14)}`;
  const snapshot = files["article-snapshot.json"];
  const triage = files["triage-decision.json"];
  const triageResponse = files["triage-response.json"];
  const expected = files["expected.json"];
  const evidenceAssets = buildEvidenceAssets({
    collectorId,
    runId,
    observedAt,
    caseId: fixture.caseId,
    articleUrl: snapshot.canonicalUrl,
    fixtureAssets: files["evidence-assets.json"].assets,
  });
  const draftEvents = files["extracted-event-candidates.json"].events ?? [];
  const excluded = triage.triageAction === "exclude";

  return {
    caseId: fixture.caseId,
    runId,
    sourceRun: envelope({
      collectorId,
      runId,
      observedAt,
      payload: {
        seedUrl: snapshot.canonicalUrl,
        status: "success",
        startedAt: new Date(now.getTime() - 30_000).toISOString(),
        finishedAt: observedAt,
        checkedUrlCount: 1,
        articleCount: 1,
        draftCount: excluded ? 0 : draftEvents.length,
        failureCount: 0,
        diagnostics: [
          { key: "fixture_case", value: fixture.caseId },
          { key: "fixture_expected_route", value: expected.route },
          { key: "fixture_workload", value: "fixture_upload" },
          { key: "fixture_environment", value: uploadEnvironment },
          {
            key: "fixture_public_catalog_enabled",
            value: publicCatalogEnabled ? "true" : "false",
          },
        ],
      },
    }),
    articleSnapshot: envelope({
      collectorId,
      runId,
      observedAt,
      payload: {
        canonicalUrl: snapshot.canonicalUrl,
        finalUrl: snapshot.canonicalUrl,
        title: snapshot.title,
        authorName: files["source.json"].name,
        capturedAt: snapshot.capturedAt,
        languageHints: ["zh", "en"],
        captureMode: captureModeForFixtureAssets(evidenceAssets),
        visibleText: snapshot.textExcerpt,
        textHash: `fixture-text-${fixture.caseId}`,
        evidenceAssetIds: evidenceAssets.map((asset) => asset.payload.assetId),
        contentHash: `fixture-content-${fixture.caseId}`,
      },
    }),
    evidenceAssets,
    eventDrafts: excluded
      ? []
      : draftEvents.map((event, index) =>
          buildEventDraft({
            collectorId,
            runId,
            observedAt,
            articleUrl: snapshot.canonicalUrl,
            caseId: fixture.caseId,
            event,
            index,
            triage,
            publicCatalogEnabled,
            evidenceAssetIds: evidenceAssets.map((asset) => asset.payload.assetId),
          }),
        ),
    excludedArticle: excluded
      ? envelope({
          collectorId,
          runId,
          observedAt,
          payload: {
            articleUrl: snapshot.canonicalUrl,
            triageAttemptId: `${runId}-triage`,
            triageDecision: triage.triageDecision,
            triageAction: "exclude",
            confidence: triage.confidence,
            publicSignals: triage.publicSignals ?? [],
            exclusionSignals: triage.exclusionSignals ?? [],
            exclusionReason:
              triage.exclusionReason ??
              triage.exclusionSignals?.[0] ??
              "Fixture triage excluded this article.",
            evidenceAssetIds: evidenceAssets.map((asset) => asset.payload.assetId),
            promptVersion: "fixture-event-pipeline-v2",
            schemaVersion: triageResponse.schemaVersion,
            provider: triageResponse.provider,
            model: triageResponse.model,
          },
        })
      : undefined,
  };
}

function buildEvidenceAssets({
  collectorId,
  runId,
  observedAt,
  caseId,
  articleUrl,
  fixtureAssets,
}) {
  return fixtureAssets.map((asset) =>
    envelope({
      collectorId,
      runId,
      observedAt,
      payload: {
        assetId: asset.assetId,
        articleUrl,
        role: evidenceRole(asset.kind),
        mediaType: "image",
        storagePath: `fixture-assets/${caseId}/${asset.assetId}.png`,
        contentHash: `fixture-${caseId}-${asset.assetId}`,
        textContent: asset.source,
        extractedBy: "manual",
        confidence: 1,
      },
    }),
  );
}

function buildEventDraft({
  collectorId,
  runId,
  observedAt,
  articleUrl,
  caseId,
  event,
  index,
  triage,
  publicCatalogEnabled,
  evidenceAssetIds,
}) {
  const signals = new Set(event.signals ?? []);
  signals.add("fixture_data");
  if (event.registrationQrAssetId) signals.add("qr_registration");
  const triageDecision = publicCatalogEnabled
    ? triage.triageDecision
    : "possible_public_activity";
  const triageAction = publicCatalogEnabled ? triage.triageAction : "review";

  return envelope({
    collectorId,
    runId,
    observedAt,
    payload: {
      articleUrl,
      extractionAttemptId: `${runId}-event-${index + 1}`,
      captureMode: captureModeFromEvent(event),
      triageDecision,
      triageAction,
      triageConfidence: triage.confidence,
      publicSignals: triage.publicSignals ?? [],
      exclusionSignals: triage.exclusionSignals ?? [],
      publicEligibility: event.publicEligibility,
      eventKind: event.eventKind,
      scheduleKind: event.scheduleKind,
      title: event.title,
      originalTitle: event.originalTitle,
      organizer: event.organizer,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      recurrenceRule: event.recurrenceRule,
      occurrenceStartsAt: event.occurrenceStartsAt,
      timezone: event.timezone ?? "Asia/Shanghai",
      venueName: event.venueName,
      venueAddress: event.venueAddress,
      city: event.city ?? "Beijing",
      reservationStatus: event.reservationStatus,
      registrationRequirement: event.registrationRequirement,
      registrationAction: event.registrationAction,
      registrationUrl: event.registrationUrl,
      scheduleText: event.scheduleText,
      posterAssetId: event.posterAssetId,
      qrAssetId: event.qrAssetId,
      registrationQrAssetId: event.registrationQrAssetId,
      summary: event.summary ?? `Fixture case ${caseId}.`,
      entryNotes: event.entryNotes,
      signals: [...signals],
      evidenceAssetIds: uniqueStrings([
        ...(event.evidenceAssetIds ?? []),
        event.posterAssetId,
        event.qrAssetId,
        event.registrationQrAssetId,
        ...evidenceAssetIds,
      ]),
      fieldEvidence: {
        title: [event.posterAssetId ?? "visibleText"].filter(Boolean),
        startsAt: [event.posterAssetId ?? "visibleText"].filter(Boolean),
        venueName: ["visibleText"],
      },
      confidence: event.confidence,
      hardBlockers: event.hardBlockers ?? [],
      softBlockers: event.softBlockers ?? [],
      resolutionDecision: event.resolutionDecision,
    },
  });
}

async function uploadBuiltFixture({ config, fetchImpl, built }) {
  const uploaded = {
    sourceRun: undefined,
    articleSnapshot: undefined,
    evidenceAssets: 0,
    eventDrafts: 0,
    excludedArticles: 0,
  };

  uploaded.sourceRun = await postCollectorJson({
    config,
    fetchImpl,
    path: "/api/collector/source-run",
    body: built.sourceRun,
  });
  uploaded.articleSnapshot = await postCollectorJson({
    config,
    fetchImpl,
    path: "/api/collector/article-snapshot",
    body: built.articleSnapshot,
  });
  for (const evidence of built.evidenceAssets) {
    await postCollectorJson({
      config,
      fetchImpl,
      path: "/api/collector/evidence-asset",
      body: evidence,
    });
    uploaded.evidenceAssets += 1;
  }
  for (const draft of built.eventDrafts) {
    await postCollectorJson({
      config,
      fetchImpl,
      path: "/api/collector/event-draft",
      body: draft,
    });
    uploaded.eventDrafts += 1;
  }
  if (built.excludedArticle) {
    await postCollectorJson({
      config,
      fetchImpl,
      path: "/api/collector/excluded-article",
      body: built.excludedArticle,
    });
    uploaded.excludedArticles += 1;
  }

  return {
    caseId: built.caseId,
    runId: built.runId,
    uploaded,
  };
}

async function postCollectorJson({ config, fetchImpl, path, body }) {
  const response = await fetchImpl(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: config.headers,
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(`collector_upload_failed:${path}:${response.status}`);
  }
  return data;
}

function captureModeForFixtureAssets(evidenceAssets) {
  const roles = evidenceAssets.map((asset) => asset.payload.role);
  if (roles.includes("registration") && roles.includes("poster")) {
    return "image_with_qr_registration";
  }
  if (roles.includes("registration")) return "text_with_qr_registration";
  if (roles.includes("poster")) return "image_dominant";
  return "text_complete";
}

function captureModeFromEvent(event) {
  if (event.registrationQrAssetId && event.posterAssetId) {
    return "image_with_qr_registration";
  }
  if (event.registrationQrAssetId) return "text_with_qr_registration";
  if (event.posterAssetId) return "image_dominant";
  return "text_complete";
}

function evidenceRole(kind) {
  if (kind === "registration_qr") return "registration";
  if (kind === "qr") return "qr";
  if (kind === "poster") return "poster";
  return "article_image";
}

function envelope({ collectorId, runId, observedAt, payload }) {
  return {
    collectorId,
    runId,
    observedAt,
    payloadVersion,
    payload: removeUndefined(payload),
  };
}

function removeUndefined(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value))];
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

export async function runFixtureUploadCli(argv = process.argv.slice(2)) {
  const args = parseFixtureArgs(argv);
  const env = mergeEnvs(process.env, loadEnvFile(args.envFile));
  const result = await runFixtureUpload({
    env,
    caseId: args.caseId,
    all: args.all,
    allowHostedWrite: args.allowHostedWrite,
    allowPublicFixtureData: args.allowPublicFixtureData,
  });
  console.log(formatFixtureUploadSummary(result));
  console.log(JSON.stringify(result, null, 2));
  return result;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  runFixtureUploadCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
