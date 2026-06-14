/// <reference lib="deno.ns" />

import { assert, assertEquals } from "./test_assertions.ts";
import { runAnalysisPipeline } from "./pipeline.ts";

Deno.test("runAnalysisPipeline writes production bundle, usage, evidence, draft, canonical event, dedupe, and ledger", async () => {
  const db = createRecordingDb();
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "published");
  assert(db.table("article_bundles").length === 1);
  assert(db.table("llm_usage_ledger").length === 1);
  assert(db.table("evidence_assets").length === 1);
  assert(db.table("event_drafts").length === 1);
  assert(db.table("canonical_events").length === 1);
  assert(db.table("dedupe_decisions").length === 1);
  assert(db.table("processing_ledger").length === 1);
  assertEquals(db.table("llm_usage_ledger")[0].source_id, "embassy-feed");
  assertEquals(
    db.table("llm_usage_ledger")[0].source_url,
    "https://mp.weixin.qq.com/s/example",
  );
  assertEquals(
    db.table("llm_usage_ledger")[0].prompt_version,
    "analyze-article-bundle-v1",
  );
  assertEquals(
    db.table("llm_usage_ledger")[0].schema_version,
    "analysis-output-v1",
  );
  assertEquals(db.table("llm_usage_ledger")[0].params, {
    responseFormat: "json_object",
  });
});

Deno.test("runAnalysisPipeline writes article bundle status through protected status writer", async () => {
  const db = createRecordingDb();
  await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(
    db.articleBundleWrites.map((call) => call.status),
    ["analysis_started", "processed"],
  );
  assertEquals(db.table("article_bundles")[0].status, "processed");
});

Deno.test("runAnalysisPipeline does not downgrade committed output when final bundle status update fails", async () => {
  const db = createRecordingDb({
    failArticleBundleStatuses: {
      processed: {
        code: "status_update_failed",
        message: "status update failed",
      },
    },
  });
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider({
      outputOverrides: {
        decision: "excluded",
        reason: "Not a public event.",
        events: [],
        excludedArticle: {
          triageDecision: "non_public_news",
          exclusionReason: "News article.",
        },
        dedupe: { decision: "insufficient_info", confidence: 0.9 },
      },
    }),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "excluded");
  assertEquals(db.table("excluded_articles").length, 1);
  assertEquals(db.table("processing_ledger").length, 1);
  assertEquals(db.table("processing_ledger")[0].state, "excluded");
  assertEquals(db.table("llm_usage_ledger").length, 1);
  assertEquals(db.table("llm_usage_ledger")[0].status, "succeeded");
});

Deno.test("runAnalysisPipeline records duplicate candidates as merge terminal decisions", async () => {
  const db = createRecordingDb({
    canonicalCandidates: [
      {
        event_id: "existing-event",
        title: "Example Public Lecture",
        starts_at: "2026-06-10T11:00:00+08:00",
        source_url: "https://mp.weixin.qq.com/s/example",
      },
    ],
  });
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "duplicate");
  assertEquals(db.table("canonical_events").length, 0);
  assertEquals(db.table("event_drafts")[0].review_state, "rejected");
  assertEquals(db.table("event_drafts")[0].editor_decision, "merge");
  assertEquals(db.table("event_drafts")[0].actionability_status, "merged");
  assertEquals(db.table("event_drafts")[0].exception_reason_codes, [
    "possible_duplicate",
  ]);
  assertEquals(db.table("dedupe_decisions")[0].decision, "same_event");
  assertEquals(db.table("processing_ledger")[0].state, "duplicate");
});

Deno.test("runAnalysisPipeline does not publish non-Beijing events to canonical catalog", async () => {
  const db = createRecordingDb();
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider({
      eventOverrides: {
        city: "成都",
        venueName: "成都富力丽思卡尔顿酒店",
      },
    }),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "excluded");
  assertEquals(db.table("event_drafts").length, 1);
  assertEquals(db.table("event_drafts")[0].city, "成都");
  assertEquals(db.table("event_drafts")[0].review_state, "rejected");
  assertEquals(db.table("event_drafts")[0].editor_decision, "discard");
  assertEquals(db.table("event_drafts")[0].exception_reason_codes, [
    "not_beijing_event",
  ]);
  assertEquals(
    db.table("event_drafts")[0].actionability_status,
    "discarded",
  );
  assertEquals(db.table("canonical_events").length, 0);
  assertEquals(db.table("processing_ledger")[0].state, "excluded");
});

Deno.test("runAnalysisPipeline publishes actionable events while clearing source article registration URLs", async () => {
  const db = createRecordingDb();
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider({
      eventOverrides: {
        confidence: 0.99,
        reservationStatus: "required",
        registrationAction: "Scan QR code to register",
        registrationUrl: "https://mp.weixin.qq.com/s/example",
        evidence: [],
        publish: { createCanonicalEvent: true, confidence: 0.99 },
      },
      outputOverrides: {
        decision: "published",
        confidence: 0.99,
        dedupe: { decision: "new_event", confidence: 0.99 },
      },
    }),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "published");
  assertEquals(db.table("canonical_events").length, 1);
  assertEquals(db.table("processing_ledger")[0].state, "published");
  const draft = db.table("event_drafts")[0];
  assertEquals(draft.review_state, "approved");
  assertEquals(draft.editor_decision, "publish");
  assertEquals(draft.actionability_status, "actionable");
  assertEquals(draft.exception_reason_codes, []);
  assertEquals(draft.registration_url, undefined);
  assertEquals(draft.soft_blockers, [
    {
      code: "registration_url_is_source_article",
      message:
        "Registration URL points back to the source article instead of an actionable registration path.",
    },
    {
      code: "registration_evidence_missing",
      message:
        "Registration is required but no URL, QR, or evidence path is present.",
    },
  ]);
});

Deno.test("runAnalysisPipeline clears source registration URLs but can publish with QR evidence", async () => {
  const db = createRecordingDb();
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider({
      eventOverrides: {
        confidence: 0.99,
        reservationStatus: "required",
        registrationAction: "Scan QR code to register",
        registrationUrl: "https://mp.weixin.qq.com/s/example",
        evidence: [{ imageId: "poster-1", role: "qr", confidence: 0.93 }],
        publish: { createCanonicalEvent: true, confidence: 0.99 },
      },
      outputOverrides: {
        decision: "published",
        confidence: 0.99,
        dedupe: { decision: "new_event", confidence: 0.99 },
      },
    }),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "published");
  assertEquals(db.table("event_drafts")[0].registration_url, undefined);
  assertEquals(db.table("event_drafts")[0].editor_decision, "publish");
  assertEquals(db.table("event_drafts")[0].actionability_status, "actionable");
  assertEquals(db.table("event_drafts")[0].exception_reason_codes, []);
  assertEquals(
    db.table("event_drafts")[0].registration_qr_asset_id,
    "evidence-1-qr-poster-1-bundle-1",
  );
  assertEquals(db.table("event_drafts")[0].soft_blockers, []);
  assertEquals(db.table("canonical_events").length, 1);
  assertEquals(db.table("canonical_events")[0].registration_url, undefined);
  assertEquals(
    db.table("canonical_events")[0].registration_qr_asset_id,
    "evidence-1-qr-poster-1-bundle-1",
  );
});

Deno.test("runAnalysisPipeline auto-publishes high-confidence public activities even when model leaves eligibility unclear", async () => {
  const db = createRecordingDb();
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider({
      eventOverrides: {
        publicEligibility: "unclear",
        confidence: 0.99,
        publish: { createCanonicalEvent: false, confidence: 0.2 },
      },
      outputOverrides: {
        confidence: 0.99,
        dedupe: { decision: "new_event", confidence: 0.98 },
      },
    }),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "published");
  assertEquals(db.table("event_drafts").length, 1);
  assertEquals(db.table("event_drafts")[0].review_state, "approved");
  assertEquals(db.table("canonical_events").length, 1);
  assertEquals(db.table("canonical_events")[0].public_eligibility, "unclear");
  assertEquals(db.table("processing_ledger")[0].state, "published");
});

Deno.test("runAnalysisPipeline publishes high-confidence possible public activities when actionable", async () => {
  const db = createRecordingDb();
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider({
      eventOverrides: {
        title: "BEING YOUNG：值得共同生活的未来？",
        triageDecision: "possible_public_activity",
        confidence: 0.95,
        reservationStatus: "not_required",
        registrationAction: "none",
        registrationUrl: undefined,
        publish: { createCanonicalEvent: false, confidence: 0.2 },
      },
      outputOverrides: {
        confidence: 0.95,
        dedupe: { decision: "new_event", confidence: 0.95 },
      },
    }),
    env: { provider: "mock", model: "mock-vision" },
  });

  const draft = db.table("event_drafts")[0];
  assertEquals(draft.exception_reason_codes, []);
  assertEquals(draft.editor_decision, "publish");
  assertEquals(result.status, "published");
  assertEquals(draft.review_state, "approved");
  assertEquals(
    draft.editor_reason,
    "Actionable public Beijing event with required publication fields.",
  );
  assertEquals(draft.actionability_status, "actionable");
  assertEquals(db.table("canonical_events").length, 1);
  assertEquals(db.table("canonical_events")[0].editor_decision, "publish");
  const metadata = db.table("processing_ledger")[0].metadata as {
    editorDecisions: unknown[];
  };
  assertEquals(metadata.editorDecisions[0], {
    draftId: "draft-1-bundle-1",
    title: "BEING YOUNG：值得共同生活的未来？",
    decision: "publish",
    reason: "Actionable public Beijing event with required publication fields.",
    actionabilityStatus: "actionable",
    exceptionReasonCodes: [],
  });
});

Deno.test("runAnalysisPipeline does not hard block actionable public activities only because event kind is unsupported", async () => {
  const db = createRecordingDb();
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider({
      eventOverrides: {
        title: "Support Mexico vs South Korea - World Cup Viewing Party",
        triageDecision: "possible_public_activity",
        publicEligibility: "public",
        eventKind: "unsupported",
        scheduleKind: "single",
        confidence: 0.95,
        reservationStatus: "not_required",
        registrationAction: "visit",
        registrationUrl: undefined,
        publish: { createCanonicalEvent: false, confidence: 0.2 },
      },
      outputOverrides: {
        confidence: 0.95,
        dedupe: { decision: "new_event", confidence: 0.95 },
      },
    }),
    env: { provider: "mock", model: "mock-vision" },
  });

  const draft = db.table("event_drafts")[0];
  assertEquals(result.status, "published");
  assertEquals(draft.editor_decision, "publish");
  assertEquals(draft.exception_reason_codes, []);
  assertEquals(draft.actionability_status, "actionable");
  assertEquals(draft.event_kind, "unsupported");
  assertEquals(db.table("canonical_events").length, 1);
  assertEquals(db.table("canonical_events")[0].event_kind, "unsupported");
});

Deno.test("runAnalysisPipeline auto-publishes explicit single-session Beijing events when provider marks schedule unsupported", async () => {
  const db = createRecordingDb();
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider({
      eventOverrides: {
        title: "RELO Beijing English Teaching Seminar",
        startsAt: "2026-06-13T09:00:00+00:00",
        endsAt: "2026-06-13T17:00:00+00:00",
        timezone: "Asia/Shanghai",
        publicEligibility: "unclear",
        eventKind: "single",
        scheduleKind: "unsupported",
        confidence: 0.95,
        publish: { createCanonicalEvent: false, confidence: 0.2 },
      },
      outputOverrides: {
        confidence: 0.95,
        dedupe: { decision: "new_event", confidence: 0.95 },
      },
    }),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "published");
  assertEquals(db.table("event_drafts")[0].schedule_kind, "single");
  assertEquals(
    db.table("event_drafts")[0].starts_at,
    "2026-06-13T09:00:00+08:00",
  );
  assertEquals(db.table("canonical_events").length, 1);
});

Deno.test("runAnalysisPipeline does not auto-publish high-confidence activities marked not public", async () => {
  const db = createRecordingDb();
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider({
      eventOverrides: {
        publicEligibility: "not_public",
        confidence: 0.99,
        publish: { createCanonicalEvent: false, confidence: 0.2 },
      },
      outputOverrides: {
        confidence: 0.99,
        dedupe: { decision: "new_event", confidence: 0.98 },
      },
    }),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "excluded");
  assertEquals(db.table("event_drafts").length, 1);
  assertEquals(db.table("event_drafts")[0].review_state, "rejected");
  assertEquals(db.table("event_drafts")[0].editor_decision, "discard");
  assertEquals(db.table("event_drafts")[0].exception_reason_codes, [
    "not_public_eligibility",
  ]);
  assertEquals(
    db.table("event_drafts")[0].actionability_status,
    "discarded",
  );
  assertEquals(db.table("canonical_events").length, 0);
  assertEquals(db.table("processing_ledger")[0].state, "excluded");
});

Deno.test("runAnalysisPipeline in eval data class writes product-shaped rows scoped to eval", async () => {
  const db = createRecordingDb();
  await runAnalysisPipeline({
    request: {
      ...validRequest(),
      dataClass: "eval",
      evalRunId: "eval-run-1",
      storagePrefix: "article-bundles/eval/bundle-1",
    },
    storage: bundleStorage({ dataClass: "eval" }),
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(db.table("event_drafts").length, 1);
  assertEquals(db.table("event_drafts")[0].data_class, "eval");
  assertEquals(db.table("event_drafts")[0].eval_run_id, "eval-run-1");
  assertEquals(db.table("canonical_events").length, 1);
  assertEquals(db.table("canonical_events")[0].data_class, "eval");
  assertEquals(db.table("canonical_events")[0].eval_run_id, "eval-run-1");
  assertEquals(db.table("dedupe_decisions").length, 1);
  assertEquals(db.table("dedupe_decisions")[0].data_class, "eval");
  assertEquals(db.table("dedupe_decisions")[0].eval_run_id, "eval-run-1");
  assertEquals(db.table("llm_usage_ledger").length, 1);
  assertEquals(db.table("llm_usage_ledger")[0].data_class, "eval");
  assertEquals(db.table("llm_usage_ledger")[0].eval_run_id, "eval-run-1");
  assertEquals(db.table("processing_ledger").length, 1);
  assertEquals(db.table("processing_ledger")[0].data_class, "eval");
  assertEquals(db.table("processing_ledger")[0].eval_run_id, "eval-run-1");
  assertEquals(db.table("processing_ledger")[0].state, "published");
  assertEquals(db.table("evidence_assets")[0].eval_run_id, "eval-run-1");
});

Deno.test("runAnalysisPipeline writes failed ledger and failed usage when provider fails", async () => {
  const db = createRecordingDb();
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: {
      name: "mock",
      model: "mock-vision",
      async analyze() {
        throw new Error("provider_timeout");
      },
    },
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "failed");
  assertEquals(db.table("llm_usage_ledger")[0].status, "failed");
  assertEquals(db.table("llm_usage_ledger")[0].error_code, "provider_timeout");
  assertEquals(db.table("processing_ledger")[0].state, "failed");
  const ledger = db.table("processing_ledger")[0] as {
    error_details: { message: string };
  };
  assertEquals(ledger.error_details.message, "provider_timeout");
});

Deno.test("runAnalysisPipeline serializes object errors into readable failed ledger details", async () => {
  const db = createRecordingDb();
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: {
      name: "mock",
      model: "mock-vision",
      async analyze() {
        throw { code: "provider_object_error", message: "object error" };
      },
    },
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "failed");
  assertEquals(
    db.table("processing_ledger")[0].reason,
    '{"code":"provider_object_error","message":"object error"}',
  );
  const ledger = db.table("processing_ledger")[0] as {
    error_details: { message: string; code?: string };
  };
  assertEquals(ledger.error_details.message, "object error");
  assertEquals(ledger.error_details.code, "provider_object_error");
});

Deno.test("runAnalysisPipeline keeps failed ledger writable when production write fails after usage", async () => {
  const db = createRecordingDb({
    failInserts: { event_drafts: "draft_write_failed" },
    enforceUniqueIds: true,
  });
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "failed");
  assertEquals(db.table("llm_usage_ledger").length, 1);
  assertEquals(db.table("llm_usage_ledger")[0].status, "failed");
  assertEquals(db.table("llm_usage_ledger")[0].total_tokens, 200);
  assertEquals(db.table("processing_ledger").length, 1);
  assertEquals(db.table("processing_ledger")[0].state, "failed");
  assertEquals(db.table("processing_ledger")[0].reason, "draft_write_failed");
});

Deno.test("runAnalysisPipeline skips already processed bundles instead of downgrading terminal state", async () => {
  const db = createRecordingDb({ enforceUniqueIds: true });
  await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: {
      name: "mock",
      model: "mock-vision",
      async analyze() {
        throw new Error("should_not_analyze_processed_bundle");
      },
    },
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "processed");
  assertEquals(db.table("article_bundles")[0].status, "processed");
  assertEquals(db.table("llm_usage_ledger")[0].status, "succeeded");
  assertEquals(db.table("processing_ledger")[0].state, "published");
  assertEquals(db.table("canonical_events").length, 1);
});

Deno.test("runAnalysisPipeline skips fresh in-progress bundles", async () => {
  const db = createRecordingDb({
    initialArticleBundles: [{
      bundle_id: "bundle-1",
      data_class: "production",
      status: "analysis_started",
      updated_at: new Date().toISOString(),
    }],
  });
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: {
      name: "mock",
      model: "mock-vision",
      async analyze() {
        throw new Error("should_not_analyze_fresh_in_progress_bundle");
      },
    },
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "in_progress");
  assertEquals(db.table("llm_usage_ledger").length, 0);
  assertEquals(db.table("processing_ledger").length, 0);
});

Deno.test("runAnalysisPipeline reclaims stale in-progress bundles", async () => {
  const staleUpdatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000)
    .toISOString();
  const db = createRecordingDb({
    initialArticleBundles: [{
      bundle_id: "bundle-1",
      data_class: "production",
      status: "analysis_started",
      updated_at: staleUpdatedAt,
    }],
  });
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "published");
  assertEquals(db.table("article_bundles")[0].status, "processed");
  assertEquals(db.table("llm_usage_ledger").length, 1);
  assertEquals(db.table("processing_ledger").length, 1);
});

Deno.test("runAnalysisPipeline does not downgrade processed bundles when stale guards miss an overlapping failure", async () => {
  const db = createRecordingDb({
    enforceUniqueIds: true,
    staleArticleBundleLookup: true,
  });
  await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: {
      name: "mock",
      model: "mock-vision",
      async analyze() {
        throw new Error("overlapping_retry_failed");
      },
    },
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "processed");
  assertEquals(db.table("article_bundles")[0].status, "processed");
  assertEquals(db.table("llm_usage_ledger").length, 1);
  assertEquals(db.table("processing_ledger").length, 1);
  assertEquals(
    db.table("processing_ledger").map((row) => row.state),
    ["published"],
  );
  assertEquals(db.table("canonical_events").length, 1);
});

Deno.test("runAnalysisPipeline records provider usage when schema validation fails", async () => {
  const db = createRecordingDb();
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: {
      name: "mock",
      model: "mock-vision",
      async analyze() {
        return {
          json: JSON.stringify({
            decision: "maybe",
            reason: "Invalid schema",
            confidence: 0.5,
            events: [],
            dedupe: { decision: "new_event", confidence: 0.5 },
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          }),
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
      },
    },
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "failed");
  assertEquals(db.table("llm_usage_ledger")[0].status, "failed");
  assertEquals(db.table("llm_usage_ledger")[0].input_tokens, 10);
  assertEquals(db.table("llm_usage_ledger")[0].output_tokens, 5);
  assertEquals(db.table("llm_usage_ledger")[0].total_tokens, 15);
  assertEquals(db.table("processing_ledger")[0].state, "failed");
});

Deno.test("runAnalysisPipeline creates storage-backed evidence rows instead of stable remote WeChat URLs", async () => {
  const storage = bundleStorage({ imageKind: "stable" });
  const db = createRecordingDb();
  await runAnalysisPipeline({
    request: validRequest(),
    storage,
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  const evidence = db.table("evidence_assets")[0] as Record<string, unknown>;
  assertEquals(evidence.storage_bucket, "event-evidence-assets");
  assertEquals(
    evidence.storage_path,
    "production/articles/bundle-1/evidence-1-poster-poster-1-bundle-1.jpg",
  );
  assertEquals(
    evidence.public_url,
    "https://supabase.test/storage/v1/object/public/event-evidence-assets/production/articles/bundle-1/evidence-1-poster-poster-1-bundle-1.jpg",
  );
  assertEquals(String(evidence.public_url).includes("mmbiz.qpic.cn"), false);
  assertEquals(evidence.source_url, "https://mmbiz.qpic.cn/remote-poster");
  assertEquals(storage.uploaded.length, 1);
  assertEquals(storage.uploaded[0].bucket, "event-evidence-assets");
  assertEquals(
    storage.uploaded[0].path,
    "production/articles/bundle-1/evidence-1-poster-poster-1-bundle-1.jpg",
  );
});

Deno.test("runAnalysisPipeline falls back to bundle image roles when provider omits evidence", async () => {
  const storage = bundleStorage({ imageKind: "stable", roleHint: "poster" });
  const db = createRecordingDb();
  await runAnalysisPipeline({
    request: validRequest(),
    storage,
    db,
    provider: successfulProvider({ eventOverrides: { evidence: [] } }),
    env: { provider: "mock", model: "mock-vision" },
  });

  const evidence = db.table("evidence_assets")[0] as {
    role: string;
    metadata: { imageId: string };
  };
  assertEquals(evidence.role, "poster");
  assertEquals(
    db.table("canonical_events")[0].poster_image_url,
    "https://supabase.test/storage/v1/object/public/event-evidence-assets/production/articles/bundle-1/evidence-1-poster-poster-1-bundle-1.jpg",
  );
});

Deno.test("runAnalysisPipeline falls back to bundle image roles when provider evidence image ids do not match", async () => {
  const storage = bundleStorage({ imageKind: "stable", roleHint: "poster" });
  const db = createRecordingDb();
  await runAnalysisPipeline({
    request: validRequest(),
    storage,
    db,
    provider: successfulProvider({
      eventOverrides: {
        evidence: [{ imageId: "image-1", role: "poster", confidence: 0.8 }],
      },
    }),
    env: { provider: "mock", model: "mock-vision" },
  });

  const evidence = db.table("evidence_assets")[0] as {
    role: string;
    metadata: { imageId: string };
  };
  assertEquals(evidence.role, "poster");
  assertEquals(evidence.metadata.imageId, "poster-1");
  assertEquals(
    db.table("event_drafts")[0].poster_image_url,
    "https://supabase.test/storage/v1/object/public/event-evidence-assets/production/articles/bundle-1/evidence-1-poster-poster-1-bundle-1.jpg",
  );
});

Deno.test("runAnalysisPipeline records QR evidence when registration URL points at a bundle image", async () => {
  const storage = bundleStorage({ imageKind: "stable" });
  const db = createRecordingDb();
  await runAnalysisPipeline({
    request: validRequest(),
    storage,
    db,
    provider: successfulProvider({
      eventOverrides: {
        evidence: [],
        registrationUrl: "https://mmbiz.qpic.cn/remote-poster",
      },
    }),
    env: { provider: "mock", model: "mock-vision" },
  });

  const evidence = db.table("evidence_assets")[0] as { role: string };
  assertEquals(evidence.role, "qr");
  assertEquals(
    db.table("event_drafts")[0].registration_qr_image_url,
    "https://supabase.test/storage/v1/object/public/event-evidence-assets/production/articles/bundle-1/evidence-1-qr-poster-1-bundle-1.jpg",
  );
});

Deno.test("runAnalysisPipeline keeps per-event canonical ids isolated in multi-event dedupe rows", async () => {
  const db = createRecordingDb();
  await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: multiEventProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(db.table("canonical_events").length, 1);
  assertEquals(db.table("dedupe_decisions").length, 2);
  assertEquals(
    db.table("dedupe_decisions")[0].canonical_event_id,
    "event-1-bundle-1",
  );
  assertEquals(db.table("dedupe_decisions")[1].canonical_event_id, undefined);
});

Deno.test("runAnalysisPipeline records reference-only evidence without fabricating poster URLs", async () => {
  const db = createRecordingDb();
  await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage({ imageKind: "reference" }),
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  const evidence = db.table("evidence_assets")[0];
  assertEquals(evidence.storage_bucket, "event-evidence-assets");
  assertEquals(evidence.storage_path, undefined);
  assertEquals(evidence.public_url, undefined);
  assertEquals(evidence.source_url, "https://mmbiz.qpic.cn/remote-poster");

  const draft = db.table("event_drafts")[0];
  assertEquals(draft.poster_asset_id, "evidence-1-poster-poster-1-bundle-1");
  assertEquals(draft.poster_image_url, undefined);

  const canonical = db.table("canonical_events")[0];
  assertEquals(
    canonical.poster_asset_id,
    "evidence-1-poster-poster-1-bundle-1",
  );
  assertEquals(canonical.poster_image_url, undefined);
});

Deno.test("runAnalysisPipeline writes excluded article and ledger for excluded output", async () => {
  const db = createRecordingDb();
  await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: {
      name: "mock",
      model: "mock-vision",
      async analyze() {
        return {
          json: JSON.stringify({
            decision: "excluded",
            reason: "Official visit news without public activity",
            confidence: 0.92,
            excludedArticle: {
              triageDecision: "official_visit",
              exclusionReason: "No public registration or attendance signal",
              publicSignals: [],
              exclusionSignals: ["official visit"],
            },
            events: [],
            dedupe: { decision: "insufficient_info", confidence: 0.4 },
            usage: { inputTokens: 90, outputTokens: 20, totalTokens: 110 },
          }),
          usage: { inputTokens: 90, outputTokens: 20, totalTokens: 110 },
        };
      },
    },
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(db.table("excluded_articles").length, 1);
  assertEquals(db.table("processing_ledger")[0].state, "excluded");
});

function validRequest() {
  return {
    sourceUrl: "https://mp.weixin.qq.com/s/example",
    publishedAt: "2026-06-08T10:00:00+08:00",
    bundleId: "bundle-1",
    storagePrefix: "article-bundles/production/bundle-1",
    contentHash: "sha256:abc",
    sourceProvider: "wechat2rss",
    sourceId: "embassy-feed",
    sourceName: "Example Embassy",
    dataClass: "production" as const,
  };
}

function bundleStorage(
  {
    dataClass = "production",
    imageKind = "stable",
    roleHint,
  }: {
    dataClass?: "production" | "eval" | "test" | "smoke";
    imageKind?: "stable" | "reference";
    roleHint?: string;
  } = {},
) {
  const image = imageKind === "stable"
    ? {
      imageId: "poster-1",
      path: "images/poster.jpg",
      hasBytes: true,
      sourceUrl: "https://mmbiz.qpic.cn/remote-poster",
      contentType: "image/jpeg",
      contentHash: "sha256:poster",
      width: 1080,
      height: 1440,
      altText: "Poster",
      roleHint,
    }
    : {
      imageId: "poster-1",
      path: "images/poster-1.reference.json",
      hasBytes: false,
      sourceUrl: "https://mmbiz.qpic.cn/remote-poster",
      contentType: "image/jpeg",
      contentHash: "sha256:poster",
      width: 1080,
      height: 1440,
      altText: "Poster",
      roleHint,
    };
  const prefix = `${dataClass}/bundle-1`;
  const files: Record<string, string> = {
    [`${prefix}/manifest.json`]: JSON.stringify({
      bundleVersion: "article-bundle-v1",
      bundleId: "bundle-1",
      dataClass,
      sourceProvider: "wechat2rss",
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      canonicalUrl: "https://mp.weixin.qq.com/s/example",
      publishedAt: "2026-06-08T10:00:00+08:00",
      capturedAt: "2026-06-08T10:30:00+08:00",
      contentHash: "sha256:abc",
      images: [image],
      links: [],
      diagnostics: [],
    }),
    [`${prefix}/article.html`]: "<article></article>",
    [`${prefix}/article.txt`]: "Public lecture in Beijing",
    [`${prefix}/links.json`]: JSON.stringify({ links: [], miniPrograms: [] }),
    [`${prefix}/diagnostics.json`]: JSON.stringify({
      diagnostics: [],
      captureWarnings: [],
    }),
  };
  const bytes: Record<string, Uint8Array> = {
    [`${prefix}/images/poster.jpg`]: new Uint8Array([1, 2, 3, 4]),
  };
  const uploaded: Array<{
    bucket: string;
    path: string;
    body: Uint8Array;
    options?: { contentType?: string; upsert?: boolean };
  }> = [];
  return {
    uploaded,
    async downloadText(_bucket: string, path: string): Promise<string | null> {
      return files[path] ?? null;
    },
    async downloadBytes(
      _bucket: string,
      path: string,
    ): Promise<Uint8Array | null> {
      return bytes[path] ?? null;
    },
    async uploadBytes(
      bucket: string,
      path: string,
      body: Uint8Array,
      options?: { contentType?: string; upsert?: boolean },
    ) {
      uploaded.push({ bucket, path, body, options });
    },
    async createPublicUrl(bucket: string, path: string): Promise<string> {
      return `https://supabase.test/storage/v1/object/public/${bucket}/${path}`;
    },
  };
}

function successfulProvider({
  eventOverrides = {},
  outputOverrides = {},
}: {
  eventOverrides?: Record<string, unknown>;
  outputOverrides?: Record<string, unknown>;
} = {}) {
  return {
    name: "mock",
    model: "mock-vision",
    async analyze() {
      return {
        json: JSON.stringify({
          decision: "needs_review",
          reason: "Public event found",
          confidence: 0.88,
          events: [
            {
              title: "Example Public Lecture",
              originalTitle: "Example Public Lecture",
              organizer: "Example Embassy",
              startsAt: "2026-06-10T11:00:00+08:00",
              timezone: "Asia/Shanghai",
              city: "Beijing",
              venueName: "Cultural Center",
              reservationStatus: "required",
              registrationUrl: "https://example.org/register",
              summary: "A public lecture.",
              publicEligibility: "public",
              triageDecision: "public_activity",
              triageAction: "extract",
              eventKind: "single",
              scheduleKind: "single",
              confidence: 0.88,
              publish: {
                createCanonicalEvent: true,
                confidence: 0.93,
              },
              evidence: [
                { imageId: "poster-1", role: "poster", confidence: 0.91 },
              ],
              ...eventOverrides,
            },
          ],
          dedupe: { decision: "new_event", confidence: 0.74 },
          usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
          ...outputOverrides,
        }),
        usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
      };
    },
  };
}

function multiEventProvider() {
  return {
    name: "mock",
    model: "mock-vision",
    async analyze() {
      const event = {
        title: "Example Public Lecture",
        organizer: "Example Embassy",
        startsAt: "2026-06-10T11:00:00+08:00",
        city: "Beijing",
        venueName: "Cultural Center",
        publicEligibility: "public",
        triageDecision: "public_activity",
        triageAction: "extract",
        confidence: 0.9,
        publish: { createCanonicalEvent: true, confidence: 0.96 },
        evidence: [{ imageId: "poster-1", role: "poster", confidence: 0.91 }],
      };
      return {
        json: JSON.stringify({
          decision: "needs_review",
          reason: "Two events found",
          confidence: 0.88,
          events: [
            event,
            {
              ...event,
              title: "Second Event Needs Review",
              startsAt: undefined,
              publish: { createCanonicalEvent: false, confidence: 0.5 },
            },
          ],
          dedupe: { decision: "new_event", confidence: 0.74 },
          usage: { inputTokens: 140, outputTokens: 100, totalTokens: 240 },
        }),
        usage: { inputTokens: 140, outputTokens: 100, totalTokens: 240 },
      };
    },
  };
}

function createRecordingDb({
  canonicalCandidates = [],
  failInserts = {},
  failArticleBundleStatuses = {},
  enforceUniqueIds = false,
  staleArticleBundleLookup = false,
  initialArticleBundles = [],
}: {
  canonicalCandidates?: Record<string, unknown>[];
  failInserts?: Record<string, string>;
  failArticleBundleStatuses?: Partial<
    Record<"analysis_started" | "processed" | "failed", unknown>
  >;
  enforceUniqueIds?: boolean;
  staleArticleBundleLookup?: boolean;
  initialArticleBundles?: Record<string, unknown>[];
} = {}) {
  const rows: Record<string, Record<string, unknown>[]> = {
    article_bundles: [...initialArticleBundles],
  };
  return {
    upsertCalls: [] as Array<{
      table: string;
      payload: Record<string, unknown>;
      options?: Record<string, unknown>;
    }>,
    articleBundleWrites: [] as Array<{
      status: "analysis_started" | "processed" | "failed";
      payload: Record<string, unknown>;
    }>,
    async insert(
      table: string,
      payload: Record<string, unknown> | Record<string, unknown>[],
    ) {
      const failure = failInserts[table];
      if (failure) throw new Error(failure);
      const items = Array.isArray(payload) ? payload : [payload];
      rows[table] ??= [];
      if (enforceUniqueIds) {
        for (const item of items) {
          const uniqueKey = uniqueKeyForTable(table);
          if (
            uniqueKey && item[uniqueKey] &&
            rows[table].some((row) => row[uniqueKey] === item[uniqueKey])
          ) {
            throw new Error(`duplicate_${table}_${uniqueKey}`);
          }
        }
      }
      rows[table].push(...items);
      return items;
    },
    async upsert(
      table: string,
      payload: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) {
      const failure = failInserts[table];
      if (failure) throw new Error(failure);
      this.upsertCalls.push({ table, payload, options });
      rows[table] ??= [];
      const conflictKey = String(options?.onConflict ?? "bundle_id");
      const existingIndex = rows[table].findIndex((row) =>
        row[conflictKey] && row[conflictKey] === payload[conflictKey]
      );
      if (existingIndex >= 0) rows[table][existingIndex] = payload;
      else rows[table].push(payload);
      return payload;
    },
    async writeArticleBundle(
      payload: Record<string, unknown>,
      status: "analysis_started" | "processed" | "failed",
    ) {
      const statusFailure = failArticleBundleStatuses[status];
      if (statusFailure) throw statusFailure;
      this.articleBundleWrites.push({ status, payload });
      rows.article_bundles ??= [];
      const existingIndex = rows.article_bundles.findIndex((row) =>
        row.bundle_id === payload.bundle_id
      );
      if (status === "analysis_started") {
        if (existingIndex < 0) {
          rows.article_bundles.push(withUpdatedAt(payload));
          return "written";
        }
        if (rows.article_bundles[existingIndex].status === "failed") {
          rows.article_bundles[existingIndex] = withUpdatedAt(payload);
          return "written";
        }
        if (
          rows.article_bundles[existingIndex].status === "analysis_started" &&
          isStaleBundleClaim(rows.article_bundles[existingIndex].updated_at)
        ) {
          rows.article_bundles[existingIndex] = withUpdatedAt(payload);
          return "written";
        }
        return rows.article_bundles[existingIndex].status === "processed"
          ? "skipped_processed"
          : "skipped_existing";
      }
      if (existingIndex < 0) {
        rows.article_bundles.push(withUpdatedAt(payload));
        return "written";
      }
      if (rows.article_bundles[existingIndex].status === "processed") {
        return "skipped_processed";
      }
      rows.article_bundles[existingIndex] = withUpdatedAt(payload);
      return "written";
    },
    async findCanonicalCandidates() {
      return canonicalCandidates;
    },
    async findArticleBundle(bundleId: string, dataClass: string) {
      if (staleArticleBundleLookup) return null;
      return (rows.article_bundles ?? []).find((row) =>
        row.bundle_id === bundleId && row.data_class === dataClass
      ) ?? null;
    },
    table(name: string) {
      return rows[name] ?? [];
    },
  };
}

function withUpdatedAt(row: Record<string, unknown>) {
  return { ...row, updated_at: new Date().toISOString() };
}

function isStaleBundleClaim(value: unknown) {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) && Date.now() - timestamp > 30 * 60 * 1000;
}

function uniqueKeyForTable(table: string): string | undefined {
  return ({
    article_bundles: "bundle_id",
    canonical_events: "event_id",
    dedupe_decisions: "dedupe_id",
    event_drafts: "draft_id",
    evidence_assets: "asset_id",
    excluded_articles: "excluded_article_id",
    llm_usage_ledger: "usage_id",
    processing_ledger: "ledger_id",
  } as Record<string, string>)[table];
}
