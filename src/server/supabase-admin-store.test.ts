import { describe, expect, it } from "vitest";

import { getSupabaseAdminStore } from "./supabase-admin-store";

describe("supabase admin store", () => {
  it("maps event analysis draft review fields for admin records", async () => {
    const store = getSupabaseAdminStore(
      supabaseClientReturningEventDrafts([
        {
          id: 1,
          draft_id: "draft-v2",
          article_url: "https://mp.weixin.qq.com/s/activity",
          title: "Weekly Library Meetup",
          original_title: "每周六，来歌德798图书馆",
          organizer: "Goethe-Institut Beijing",
          starts_at: "2026-06-06T08:00:00.000Z",
          ends_at: null,
          timezone: "Asia/Shanghai",
          city: "Beijing",
          venue_name: "Goethe 798 Library",
          venue_address: null,
          reservation_status: "not_required",
          registration_action: null,
          registration_url: null,
          schedule_text: "Every Saturday 16:00-17:00",
          poster_image_url: null,
          poster_image_alt: null,
          poster_image_source_url: null,
          summary: "A weekly public library meetup.",
          entry_notes: null,
          triage_decision: "public_activity",
          triage_action: "extract",
          triage_confidence: 0.97,
          public_signals: ["public venue", "weekly schedule"],
          exclusion_signals: [],
          public_eligibility: "public",
          event_kind: "recurring",
          schedule_kind: "recurring",
          recurrence_rule: "FREQ=WEEKLY;BYDAY=SA",
          occurrence_starts_at: ["2026-06-06T08:00:00.000Z"],
          poster_asset_id: "asset-poster-1",
          qr_asset_id: "asset-qr-1",
          registration_qr_asset_id: "asset-qr-1",
          hard_blockers: [],
          soft_blockers: [
            { code: "missing_end_time", message: "No end time" },
          ],
          operator_override_reason: "Public page is readable enough.",
          resolution_decision: "new_event",
          canonical_event_id: "42",
          processing_state: "ready_for_policy",
          confidence: 0.97,
          review_state: "ready_for_review",
          evidence_asset_ids: ["asset-poster-1"],
          field_evidence: { title: ["asset-poster-1"] },
        },
      ]),
    );

    await expect(store.listEventDrafts({})).resolves.toEqual([
      expect.objectContaining({
        id: "draft-v2",
        triageDecision: "public_activity",
        triageAction: "extract",
        triageConfidence: 0.97,
        publicSignals: ["public venue", "weekly schedule"],
        publicEligibility: "public",
        scheduleKind: "recurring",
        recurrenceRule: "FREQ=WEEKLY;BYDAY=SA",
        occurrenceStartsAt: ["2026-06-06T08:00:00.000Z"],
        posterAssetId: "asset-poster-1",
        registrationQrAssetId: "asset-qr-1",
        softBlockers: [{ code: "missing_end_time", message: "No end time" }],
        operatorOverrideReason: "Public page is readable enough.",
        resolutionDecision: "new_event",
        canonicalEventId: "42",
        processingState: "ready_for_policy",
      }),
    ]);
  });

  it("maps and promotes excluded articles for admin audit", async () => {
    const updates: Array<{ table: string; payload: Record<string, unknown> }> =
      [];
    const store = getSupabaseAdminStore(
      supabaseClientForExcludedArticles(updates),
    );

    await expect(
      store.listExcludedArticles({ processingState: "excluded" }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "excluded-1",
        articleUrl: "https://mp.weixin.qq.com/s/official-visit",
        triageDecision: "official_visit",
        processingState: "excluded",
      }),
    ]);
    await expect(
      store.promoteExcludedArticle(
        "excluded-1",
        "2026-06-03T09:00:00.000Z",
      ),
    ).resolves.toMatchObject({
      id: "excluded-1",
      processingState: "promoted_to_extraction",
      promotedAt: "2026-06-03T09:00:00.000Z",
    });
    expect(updates).toEqual([
      {
        table: "excluded_articles",
        payload: {
          processing_state: "promoted_to_extraction",
          promoted_at: "2026-06-03T09:00:00.000Z",
          updated_at: "2026-06-03T09:00:00.000Z",
        },
      },
    ]);
  });

  it("maps processing ledger rows for article audit", async () => {
    const calls: unknown[] = [];
    const store = getSupabaseAdminStore(
      supabaseClientForProcessingLedger(calls),
    );

    const ledger = await store.listProcessingLedger({
      state: "excluded",
      mode: "production",
    });
    expect(ledger).toEqual([
      expect.objectContaining({
        id: "ledger-1",
        articleBundleId: "bundle-1",
        sourceUrl: "https://mp.weixin.qq.com/s/news",
        state: "excluded",
        decision: "non_public_news",
        reason: "No public attendance signal.",
        confidence: 0.93,
        provider: "dashscope",
        model: "qwen3-vl-plus",
        mode: "production",
        excludedArticleId: "excluded-1",
        errorDetails: {
          safe: "kept",
          nested: {
            other: "ok",
          },
          callbackUrl: "https://example.com/callback?token=%5Bredacted%5D",
        },
        metadata: {
          source: "fixture",
          nested: {
            safe: "kept",
          },
        },
      }),
    ]);
    expect(JSON.stringify(ledger)).not.toContain("do not leak");
    expect(JSON.stringify(ledger)).not.toContain("secret-token");
    expect(JSON.stringify(ledger)).not.toContain("session=secret");
    expect(calls).toContainEqual(["eq", "state", "excluded"]);
    expect(calls).toContainEqual(["eq", "mode", "production"]);
  });

  it("maps evaluation runs with their case results", async () => {
    const calls: unknown[] = [];
    const store = getSupabaseAdminStore(
      supabaseClientForEvaluationRuns(calls),
    );

    const evaluationRuns = await store.listEvaluationRuns({
      status: "completed",
    });
    expect(evaluationRuns).toEqual([
      expect.objectContaining({
        runId: "eval-1",
        provider: "dashscope",
        model: "qwen3-vl-plus",
        status: "completed",
        caseCount: 2,
        passCount: 1,
        failCount: 1,
        parameters: {
          temperature: 0,
          nested: {
            safe: "kept",
          },
        },
        summary: {
          notes: "one QR miss",
          nested: {
            safe: "kept",
          },
        },
        caseResults: [
          expect.objectContaining({
            id: "result-1",
            runId: "eval-1",
            caseId: "qr-registration",
            expectedAction: "publish",
            actualAction: "needs_review",
            passed: false,
            scores: {
              poster: 1,
              qr: 0,
              nested: {
                safe: "kept",
              },
            },
            errors: [
              {
                code: "missing_qr",
                nested: {
                  safe: "kept",
                },
              },
            ],
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(evaluationRuns)).not.toContain("do not leak");
    expect(JSON.stringify(evaluationRuns)).not.toContain("secret");
    expect(JSON.stringify(evaluationRuns)).not.toContain("Authorization");
    expect(calls).toContainEqual(["eq", "status", "completed"]);
    expect(calls).toContainEqual(["in", "run_id", ["eval-1"]]);
  });

  it("maps collector job result fields for admin smoke verification", async () => {
    const store = getSupabaseAdminStore(
      supabaseClientReturning([
        {
          id: 1,
          job_id: "job-1",
          seed_url: "https://example.com/a",
          state: "failed",
          requested_at: "2026-05-28T08:00:00.000Z",
          claimed_at: "2026-05-28T08:01:00.000Z",
          lease_expires_at: "2026-05-28T08:20:00.000Z",
          collector_id: "capture-worker-1",
          capture_run_id: "capture-worker-1-1",
          attempt_number: 1,
          last_heartbeat_at: null,
          last_heartbeat_stage: null,
          suggested_disposition: "failed",
          source_run_id: "run-1",
          article_bundle_ids: ["bundle-1"],
          event_draft_ids: [],
          evidence_asset_ids: ["evidence-1"],
          failure_ids: ["failure-1"],
          result_message: "Structured failure uploaded.",
          finished_at: "2026-05-28T08:02:00.000Z",
          preferred_runner: "external_capture_worker",
          actual_runner: "external_capture_worker",
          runner_state: "failed",
          fallback_eligible: false,
          fallback_reason: null,
        },
      ]),
    );

    await expect(store.listCollectorJobs()).resolves.toMatchObject([
      {
        jobId: "job-1",
        sourceRunId: "run-1",
        articleBundleIds: ["bundle-1"],
        eventDraftIds: [],
        evidenceAssetIds: ["evidence-1"],
        failureIds: ["failure-1"],
        finishedAt: "2026-05-28T08:02:00.000Z",
        preferredRunner: "external_capture_worker",
        actualRunner: "external_capture_worker",
        runnerState: "failed",
      },
    ]);
  });

  it("maps safe LLM usage rows into admin totals and model groups", async () => {
    const calls: unknown[] = [];
    const store = getSupabaseAdminStore(
      supabaseClientReturningLlmUsage([
        {
          usage_id: "usage-2",
          recorded_at: "2026-06-04T02:05:00.000Z",
          operation: "event_resolution",
          provider: "openai",
          model: "gpt-5-mini",
          status: "failed",
          mode: "eval",
          input_tokens: 500,
          output_tokens: 0,
          total_tokens: 500,
          cached_input_tokens: 0,
          reasoning_output_tokens: 0,
          cost_micro_cny: 0,
          latency_ms: 900,
          source_run_id: "run-1",
          collector_job_id: "job-1",
          article_bundle_id: null,
          event_draft_id: "draft-1",
          excluded_article_id: null,
          evaluation_run_id: "eval-1",
          metadata: {
            failureReason: "analysis_request_failed",
            workload: "event_resolution",
          },
        },
        {
          usage_id: "usage-1",
          recorded_at: "2026-06-04T02:00:00.000Z",
          operation: "event_extraction",
          provider: "openai",
          model: "gpt-5-mini",
          status: "succeeded",
          mode: "production",
          input_tokens: 900,
          output_tokens: 250,
          total_tokens: 1150,
          cached_input_tokens: 120,
          reasoning_output_tokens: 40,
          cost_micro_cny: 2100,
          latency_ms: 1800,
          source_run_id: "run-1",
          collector_job_id: "job-1",
          article_bundle_id: "bundle-1",
          event_draft_id: "draft-1",
          excluded_article_id: null,
          evaluation_run_id: null,
          metadata: {
            schemaVersion: "event-analysis-schema-v1",
            workload: "event_extraction",
          },
        },
      ], calls),
    );

    await expect(
      store.getLlmUsageSummary({
        range: {
          key: "today",
          label: "Today",
          startsAt: "2026-06-03T16:00:00.000Z",
        },
        startsAt: "2026-06-03T16:00:00.000Z",
      }),
    ).resolves.toEqual({
      range: {
        key: "today",
        label: "Today",
        startsAt: "2026-06-03T16:00:00.000Z",
      },
      latestRecordedAt: "2026-06-04T02:05:00.000Z",
      totals: {
        requestCount: 2,
        successCount: 1,
        errorCount: 1,
        inputTokens: 1400,
        outputTokens: 250,
        totalTokens: 1650,
        costMicroCny: 2100,
      },
      byModel: [
        {
          provider: "openai",
          model: "gpt-5-mini",
          operation: "event_resolution",
          workload: "event_resolution",
          environment: "eval:eval-1",
          requestCount: 1,
          totalTokens: 500,
          costMicroCny: 0,
        },
        {
          provider: "openai",
          model: "gpt-5-mini",
          operation: "event_extraction",
          workload: "event_extraction",
          environment: "production",
          requestCount: 1,
          totalTokens: 1150,
          costMicroCny: 2100,
        },
      ],
      byEnvironment: [
        {
          environment: "eval:eval-1",
          requestCount: 1,
          successCount: 0,
          errorCount: 1,
          totalTokens: 500,
          costMicroCny: 0,
          latestRecordedAt: "2026-06-04T02:05:00.000Z",
        },
        {
          environment: "production",
          requestCount: 1,
          successCount: 1,
          errorCount: 0,
          totalTokens: 1150,
          costMicroCny: 2100,
          latestRecordedAt: "2026-06-04T02:00:00.000Z",
        },
      ],
      byRun: [
        {
          runId: "eval-1",
          environment: "eval:eval-1",
          requestCount: 1,
          totalTokens: 500,
          costMicroCny: 0,
          latestRecordedAt: "2026-06-04T02:05:00.000Z",
        },
        {
          runId: "run-1",
          environment: "production",
          requestCount: 1,
          totalTokens: 1150,
          costMicroCny: 2100,
          latestRecordedAt: "2026-06-04T02:00:00.000Z",
        },
      ],
      recent: [
        expect.objectContaining({
          id: "usage-2",
          status: "failed",
          mode: "eval",
          evaluationRunId: "eval-1",
          metadata: {
            failureReason: "analysis_request_failed",
            workload: "event_resolution",
          },
        }),
        expect.objectContaining({
          id: "usage-1",
          operation: "event_extraction",
          mode: "production",
          totalTokens: 1150,
          metadata: {
            schemaVersion: "event-analysis-schema-v1",
            workload: "event_extraction",
          },
        }),
      ],
    });
    expect(calls).toContainEqual([
      "gte",
      "recorded_at",
      "2026-06-03T16:00:00.000Z",
    ]);
  });

  it("does not apply a recorded_at lower bound for all-time LLM usage", async () => {
    const calls: unknown[] = [];
    const store = getSupabaseAdminStore(
      supabaseClientReturningLlmUsage([], calls),
    );

    await expect(
      store.getLlmUsageSummary({
        range: { key: "all", label: "All" },
      }),
    ).resolves.toMatchObject({
      range: { key: "all", label: "All" },
      totals: { requestCount: 0 },
      recent: [],
    });

    expect(calls.some((call) => Array.isArray(call) && call[0] === "gte")).toBe(
      false,
    );
  });

  it("publishes drafts without poster fields when poster columns are pending", async () => {
    const inserts: Array<{ table: string; payload: Record<string, unknown> }> =
      [];
    const store = getSupabaseAdminStore(
      supabaseClientMissingPosterColumnsForPublish(inserts),
    );

    await expect(
      store.publishEventDraft({
        draft: {
          id: "draft-1",
          articleUrl: "https://mp.weixin.qq.com/s/example",
          title: "Thai Festival Beijing 2026",
          organizer: "Thai Embassy",
          startsAt: "2026-05-30T10:30:00+08:00",
          endsAt: "2026-05-31T18:00:00+08:00",
          timezone: "Asia/Shanghai",
          city: "Beijing",
          venueName: "北京朝阳公园",
          reservationStatus: "not_required",
          scheduleText: "2026年5月30日-31日 10:30-18:00",
          publicEligibility: "public",
          eventKind: "multi_day",
          scheduleKind: "multi_day",
          occurrenceStartsAt: [
            "2026-05-30T02:30:00.000Z",
            "2026-05-31T02:30:00.000Z",
          ],
          posterAssetId: "asset-poster-1",
          registrationQrAssetId: "asset-qr-1",
          hardBlockers: [],
          softBlockers: [
            { code: "missing_registration_url", message: "QR only" },
          ],
          operatorOverrideReason: "QR poster is enough for attendees.",
          resolutionDecision: "new_event",
          posterImageUrl: "https://cdn.example.com/posters/thai.png",
          posterImageAlt: "Thai Festival poster",
          posterImageSourceUrl: "https://mp.weixin.qq.com/poster.png",
          confidence: 0.9,
          reviewState: "ready_for_review",
          evidenceAssetIds: [],
          fieldEvidence: {},
        },
        publishedAt: "2026-05-29T08:00:00.000Z",
      }),
    ).resolves.toEqual({
      id: "event-1",
      title: "Thai Festival Beijing 2026",
      status: "published",
      publishedAt: "2026-05-29T08:00:00.000Z",
    });

    const eventAttempts = inserts.filter(
      (entry) => entry.table === "canonical_events",
    );
    expect(eventAttempts).toHaveLength(2);
    expect(eventAttempts[0]?.payload).toHaveProperty("poster_image_url");
    expect(eventAttempts[1]?.payload).not.toHaveProperty("poster_image_url");
    expect(eventAttempts[1]?.payload).toMatchObject({
      schedule_text: "2026年5月30日-31日 10:30-18:00",
      public_eligibility: "public",
      event_kind: "multi_day",
      schedule_kind: "multi_day",
      occurrence_starts_at: [
        "2026-05-30T02:30:00.000Z",
        "2026-05-31T02:30:00.000Z",
      ],
      poster_asset_id: "asset-poster-1",
      registration_qr_asset_id: "asset-qr-1",
      soft_blockers: [
        { code: "missing_registration_url", message: "QR only" },
      ],
      operator_override_reason: "QR poster is enough for attendees.",
      resolution_decision: "new_event",
    });
  });

  it("resolves public poster and registration QR evidence while publishing", async () => {
    const inserts: Array<{ table: string; payload: Record<string, unknown> }> =
      [];
    const store = getSupabaseAdminStore(
      supabaseClientForPublishWithEvidence(inserts, [
        {
          asset_id: "asset-poster-1",
          role: "poster",
          storage_path: "https://blob.example.com/posters/thai.png",
          source_url: "https://mmbiz.qpic.cn/poster.png",
          text_content: "Thai Festival poster",
        },
        {
          asset_id: "asset-qr-1",
          role: "registration",
          storage_path: "https://blob.example.com/qr/thai.png",
          source_url: "https://mmbiz.qpic.cn/qr.png",
          text_content: "Thai Festival registration QR",
        },
      ]),
    );

    await expect(
      store.publishEventDraft({
        draft: {
          id: "draft-1",
          articleUrl: "https://mp.weixin.qq.com/s/example",
          title: "Thai Festival Beijing 2026",
          startsAt: "2026-05-30T10:30:00+08:00",
          timezone: "Asia/Shanghai",
          city: "Beijing",
          venueName: "北京朝阳公园",
          reservationStatus: "required",
          posterAssetId: "asset-poster-1",
          registrationQrAssetId: "asset-qr-1",
          hardBlockers: [],
          softBlockers: [],
          resolutionDecision: "new_event",
          confidence: 0.9,
          reviewState: "ready_for_review",
          evidenceAssetIds: ["asset-poster-1", "asset-qr-1"],
          fieldEvidence: {},
        },
        publishedAt: "2026-05-29T08:00:00.000Z",
      }),
    ).resolves.toMatchObject({ id: "event-1" });

    expect(inserts.find((entry) => entry.table === "canonical_events")?.payload)
      .toMatchObject({
        poster_image_url: "https://blob.example.com/posters/thai.png",
        poster_image_alt: "Thai Festival poster",
        poster_image_source_url: "https://mmbiz.qpic.cn/poster.png",
        registration_qr_image_url: "https://blob.example.com/qr/thai.png",
        registration_qr_image_alt: "Thai Festival registration QR",
      });
  });
});

function supabaseClientReturningEventDrafts(rows: unknown[]) {
  const query = {
    select() {
      return query;
    },
    order() {
      return query;
    },
    limit() {
      return Promise.resolve({ data: rows, error: null });
    },
  };

  return {
    from(table: string) {
      expect(table).toBe("event_drafts");
      return query;
    },
  } as never;
}

function supabaseClientForExcludedArticles(
  updates: Array<{ table: string; payload: Record<string, unknown> }>,
) {
  const row = {
    excluded_article_id: "excluded-1",
    article_url: "https://mp.weixin.qq.com/s/official-visit",
    triage_decision: "official_visit",
    triage_action: "exclude",
    confidence: 0.94,
    public_signals: [],
    exclusion_signals: ["Official visit"],
    exclusion_reason: "Not open to ordinary attendees.",
    evidence_asset_ids: ["asset-1"],
    prompt_version: "event-triage-2026-06-03",
    schema_version: "event-triage-schema-v1",
    provider: "recorded",
    model: "fixture-model",
    processing_state: "excluded",
    promoted_at: null,
    created_at: "2026-06-03T08:00:00.000Z",
  };

  return {
    from(table: string) {
      expect(table).toBe("excluded_articles");
      const query = {
        select() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return Promise.resolve({ data: [row], error: null });
        },
        eq() {
          return query;
        },
        update(payload: Record<string, unknown>) {
          updates.push({ table, payload });
          return query;
        },
        maybeSingle() {
          return Promise.resolve({
            data: {
              ...row,
              processing_state: "promoted_to_extraction",
              promoted_at: "2026-06-03T09:00:00.000Z",
            },
            error: null,
          });
        },
      };
      return query;
    },
  } as never;
}

function supabaseClientForProcessingLedger(calls: unknown[] = []) {
  const rows = [
    {
      ledger_id: "ledger-1",
      article_bundle_id: "bundle-1",
      source_url: "https://mp.weixin.qq.com/s/news",
      content_hash: "hash-1",
      state: "excluded",
      decision: "non_public_news",
      reason: "No public attendance signal.",
      confidence: 0.93,
      provider: "dashscope",
      model: "qwen3-vl-plus",
      prompt_version: "event-analysis-2026-06-08",
      schema_version: "event-analysis-schema-v1",
      usage_id: "usage-1",
      draft_id: null,
      canonical_event_id: null,
      excluded_article_id: "excluded-1",
      mode: "production",
      error_details: {
        safe: "kept",
        prompt: "do not leak",
        nested: {
          raw_response: "do not leak",
          other: "ok",
        },
        callbackUrl: "https://example.com/callback?token=secret-token",
      },
      metadata: {
        source: "fixture",
        nested: {
          safe: "kept",
          cookie: "session=secret",
        },
      },
      created_at: "2026-06-08T01:00:00.000Z",
    },
  ];
  const query = {
    select() {
      calls.push(["select"]);
      return query;
    },
    eq(column: string, value: string) {
      calls.push(["eq", column, value]);
      return query;
    },
    order(column: string) {
      calls.push(["order", column]);
      return query;
    },
    limit(count: number) {
      calls.push(["limit", count]);
      return Promise.resolve({ data: rows, error: null });
    },
  };

  return {
    from(table: string) {
      expect(table).toBe("processing_ledger");
      return query;
    },
  } as never;
}

function supabaseClientForEvaluationRuns(calls: unknown[] = []) {
  const runRows = [
    {
      run_id: "eval-1",
      provider: "dashscope",
      model: "qwen3-vl-plus",
      prompt_version: "event-analysis-2026-06-08",
      schema_version: "event-analysis-schema-v1",
      parameters: {
        temperature: 0,
        prompt: "do not leak",
        nested: {
          safe: "kept",
          api_key: "secret",
        },
      },
      corpus_version: "regression-2026-06",
      status: "completed",
      started_at: "2026-06-08T01:00:00.000Z",
      completed_at: "2026-06-08T01:02:00.000Z",
      case_count: 2,
      pass_count: 1,
      fail_count: 1,
      summary: {
        notes: "one QR miss",
        nested: {
          safe: "kept",
          raw_response: "do not leak",
        },
      },
      artifact_bucket: "eval-artifacts",
      artifact_path: "runs/eval-1/report.json",
      created_at: "2026-06-08T01:00:00.000Z",
    },
  ];
  const caseRows = [
    {
      result_id: "result-1",
      run_id: "eval-1",
      case_id: "qr-registration",
      article_bundle_id: "bundle-1",
      expected_action: "publish",
      actual_action: "needs_review",
      passed: false,
      scores: {
        poster: 1,
        qr: 0,
        nested: {
          safe: "kept",
          token: "secret",
        },
      },
      errors: [
        {
          code: "missing_qr",
          raw_response: "do not leak",
          nested: {
            safe: "kept",
            header: "Authorization: Bearer secret",
          },
        },
      ],
      usage_id: "usage-1",
      artifact_path: "runs/eval-1/qr-registration.json",
      created_at: "2026-06-08T01:02:00.000Z",
    },
  ];

  return {
    from(table: string) {
      const query = {
        select() {
          calls.push(["select", table]);
          return query;
        },
        eq(column: string, value: string) {
          calls.push(["eq", column, value]);
          return query;
        },
        in(column: string, values: string[]) {
          calls.push(["in", column, values]);
          return query;
        },
        order(column: string) {
          calls.push(["order", table, column]);
          return query;
        },
        limit(count: number) {
          calls.push(["limit", table, count]);
          return Promise.resolve({
            data: table === "evaluation_runs" ? runRows : caseRows,
            error: null,
          });
        },
      };
      return query;
    },
  } as never;
}

function supabaseClientReturning(rows: unknown[]) {
  const query = {
    select() {
      return query;
    },
    order() {
      return query;
    },
    limit() {
      return Promise.resolve({ data: rows, error: null });
    },
  };

  return {
    from(table: string) {
      expect(table).toBe("collector_jobs");
      return query;
    },
  } as never;
}

function supabaseClientReturningLlmUsage(rows: unknown[], calls: unknown[] = []) {
  let start = 0;
  let end = rows.length - 1;
  const query = {
    select() {
      calls.push(["select"]);
      return query;
    },
    order() {
      calls.push(["order", "recorded_at"]);
      return query;
    },
    gte(column: string, value: string) {
      calls.push(["gte", column, value]);
      return query;
    },
    range(from: number, to: number) {
      calls.push(["range", from, to]);
      start = from;
      end = to;
      return Promise.resolve({ data: rows.slice(start, end + 1), error: null });
    },
  };

  return {
    from(table: string) {
      expect(table).toBe("llm_usage_ledger");
      return query;
    },
  } as never;
}

function supabaseClientMissingPosterColumnsForPublish(
  inserts: Array<{ table: string; payload: Record<string, unknown> }>,
) {
  return {
    from(table: string) {
      if (table === "evidence_assets") {
        return {
          select() {
            return {
              in() {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      }
      const query = {
        insert(payload: Record<string, unknown>) {
          inserts.push({ table, payload });
          return query;
        },
        select() {
          return query;
        },
        single() {
          if (
            table === "canonical_events" &&
            inserts.at(-1)?.payload.poster_image_url !== undefined
          ) {
            return Promise.resolve({
              data: null,
              error: {
                message:
                  "Could not find the 'poster_image_url' column in the schema cache",
              },
            });
          }
          return Promise.resolve({
            data: {
              id: 1,
              event_id: "event-1",
              title: "Thai Festival Beijing 2026",
              status: "published",
              published_at: "2026-05-29T08:00:00.000Z",
            },
            error: null,
          });
        },
        update() {
          return query;
        },
        eq() {
          return Promise.resolve({ error: null });
        },
      };
      return query;
    },
  } as never;
}

function supabaseClientForPublishWithEvidence(
  inserts: Array<{ table: string; payload: Record<string, unknown> }>,
  evidenceRows: unknown[],
) {
  return {
    from(table: string) {
      if (table === "evidence_assets") {
        return {
          select() {
            return {
              in() {
                return Promise.resolve({ data: evidenceRows, error: null });
              },
            };
          },
        };
      }
      const query = {
        insert(payload: Record<string, unknown>) {
          inserts.push({ table, payload });
          return query;
        },
        select() {
          return query;
        },
        single() {
          return Promise.resolve({
            data: {
              id: 1,
              event_id: "event-1",
              title: "Thai Festival Beijing 2026",
              status: "published",
              published_at: "2026-05-29T08:00:00.000Z",
            },
            error: null,
          });
        },
        update() {
          return query;
        },
        eq() {
          return Promise.resolve({ error: null });
        },
      };
      return query;
    },
  } as never;
}
