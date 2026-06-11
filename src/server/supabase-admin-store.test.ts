import { describe, expect, it } from "vitest";

import { getSupabaseAdminStore } from "./supabase-admin-store";

describe("supabase admin store", () => {
  it("maps event analysis draft review fields for admin records", async () => {
    const calls: unknown[] = [];
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
      ], calls),
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
    expect(calls).toContainEqual(["eq", "data_class", "production"]);
  });

  it("maps and promotes excluded articles for admin audit", async () => {
    const updates: Array<{ table: string; payload: Record<string, unknown> }> =
      [];
    const calls: unknown[] = [];
    const store = getSupabaseAdminStore(
      supabaseClientForExcludedArticles(updates, calls),
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
    expect(calls).toContainEqual(["eq", "data_class", "production"]);
    expect(calls.filter((call) =>
      Array.isArray(call) && call[0] === "eq" && call[1] === "data_class"
    )).toHaveLength(2);
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
      dataClass: "production",
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
        dataClass: "production",
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
    expect(calls).toContainEqual(["eq", "data_class", "production"]);
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
        validity: "valid",
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
    expect(calls).toContainEqual(["eq", "validity", "valid"]);
    expect(calls).toContainEqual(["in", "run_id", ["eval-1"]]);
  });

  it("maps V5 pipeline runs with steps, attempts, and artifacts", async () => {
    const calls: unknown[] = [];
    const store = getSupabaseAdminStore(supabaseClientForPipelineRuns(calls));

    const runs = await store.listPipelineRuns({
      dataClass: "production",
      status: "completed",
    });

    expect(runs).toEqual([
      expect.objectContaining({
        runId: "pipe-1",
        dataClass: "production",
        sourceKind: "article_bundle",
        sourceId: "bundle-1",
        articleBundleId: "bundle-1",
        caseId: "case-1",
        status: "completed",
        decision: "needs_review",
        reason: "Missing registration QR.",
        metadata: {
          safe: "kept",
        },
        steps: [
          expect.objectContaining({
            stepId: "step-1",
            stepOrder: 1,
            nodeName: "full_extract",
            provider: "dashscope",
            model: "qwen3-vl-plus",
            promptVersion: "full-extract-v5",
            schemaVersion: "event-extract-v5",
            usageId: "usage-1",
            inputArtifactIds: ["artifact-input"],
            outputArtifactIds: ["artifact-output"],
            validationIssues: [
              {
                code: "missing_registration_qr",
                safe: "kept",
              },
            ],
            attempts: [
              expect.objectContaining({
                attemptId: "attempt-1",
                attemptNumber: 1,
                usage: {
                  totalTokens: 1450,
                  costMicroCny: 4200,
                },
                validatorIssues: [
                  {
                    code: "missing_registration_qr",
                    safe: "kept",
                  },
                ],
                latencyMs: 3000,
              }),
            ],
          }),
        ],
        artifacts: [
          expect.objectContaining({
            artifactId: "artifact-output",
            stepId: "step-1",
            path: "runs/pipe-1/full_extract.json",
            kind: "extraction",
            bucket: "eval-artifacts",
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(runs)).not.toContain("do not leak");
    expect(JSON.stringify(runs)).not.toContain("secret");
    expect(calls).toContainEqual(["eq", "pipeline_runs", "data_class", "production"]);
    expect(calls).toContainEqual(["eq", "pipeline_runs", "status", "completed"]);
    expect(calls).toContainEqual(["eq", "pipeline_steps", "data_class", "production"]);
    expect(calls).toContainEqual(["eq", "pipeline_artifacts", "data_class", "production"]);
    expect(calls).toContainEqual(["eq", "pipeline_attempts", "data_class", "production"]);
    expect(calls).toContainEqual(["in", "pipeline_steps", "run_id", ["pipe-1"]]);
    expect(calls).toContainEqual(["in", "pipeline_artifacts", "run_id", ["pipe-1"]]);
    expect(calls).toContainEqual(["in", "pipeline_attempts", "run_id", ["pipe-1"]]);
  });

  it("can list invalidated evaluation runs for audit", async () => {
    const calls: unknown[] = [];
    const store = getSupabaseAdminStore(
      supabaseClientForEvaluationRuns(calls, {
        validity: "invalidated",
        invalidated_reason: "pre_288_live_eval_used_legacy_text_metadata_path",
        invalidated_at: "2026-06-09T07:00:00.000Z",
      }),
    );

    const evaluationRuns = await store.listEvaluationRuns({
      validity: "invalidated",
    });

    expect(evaluationRuns).toEqual([
      expect.objectContaining({
        runId: "eval-1",
        validity: "invalidated",
        invalidatedReason: "pre_288_live_eval_used_legacy_text_metadata_path",
        invalidatedAt: "2026-06-09T07:00:00.000Z",
      }),
    ]);
    expect(calls).toContainEqual(["eq", "validity", "invalidated"]);
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
          data_class: "eval",
          input_tokens: 500,
          output_tokens: 0,
          total_tokens: 500,
          cached_input_tokens: 0,
          reasoning_output_tokens: 0,
          cost_micro_cny: 0,
          latency_ms: 900,
          pipeline_run_id: "pipe-1",
          pipeline_step_id: "step-full-extract-1",
          source_id: "source-1",
          source_url: "https://mp.weixin.qq.com/s/failure",
          prompt_version: "prompt-v2",
          schema_version: "schema-v2",
          params: { temperature: 0, responseFormat: { type: "json_object" } },
          error_code: "model_provider_http_error",
          request_artifact_path: "runs/pipe-1/full_extract/request.json",
          response_artifact_path: "runs/pipe-1/full_extract/response.json",
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
          data_class: "production",
          input_tokens: 900,
          output_tokens: 250,
          total_tokens: 1150,
          cached_input_tokens: 120,
          reasoning_output_tokens: 40,
          cost_micro_cny: 2100,
          latency_ms: 1800,
          pipeline_run_id: "pipe-1",
          pipeline_step_id: "step-full-extract-2",
          source_id: "source-1",
          source_url: "https://mp.weixin.qq.com/s/example",
          prompt_version: "prompt-v1",
          schema_version: "schema-v1",
          params: { temperature: 0 },
          error_code: null,
          request_artifact_path: "runs/pipe-1/full_extract/request-2.json",
          response_artifact_path: "runs/pipe-1/full_extract/response-2.json",
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
          dataClass: "eval",
          pipelineRunId: "pipe-1",
          pipelineStepId: "step-full-extract-1",
          sourceId: "source-1",
          sourceUrl: "https://mp.weixin.qq.com/s/failure",
          promptVersion: "prompt-v2",
          schemaVersion: "schema-v2",
          params: { temperature: 0, responseFormat: { type: "json_object" } },
          errorCode: "model_provider_http_error",
          requestArtifactPath: "runs/pipe-1/full_extract/request.json",
          responseArtifactPath: "runs/pipe-1/full_extract/response.json",
          evaluationRunId: "eval-1",
          metadata: {
            failureReason: "analysis_request_failed",
            workload: "event_resolution",
          },
        }),
        expect.objectContaining({
          id: "usage-1",
          operation: "event_extraction",
          dataClass: "production",
          pipelineRunId: "pipe-1",
          pipelineStepId: "step-full-extract-2",
          sourceId: "source-1",
          sourceUrl: "https://mp.weixin.qq.com/s/example",
          promptVersion: "prompt-v1",
          schemaVersion: "schema-v1",
          params: { temperature: 0 },
          requestArtifactPath: "runs/pipe-1/full_extract/request-2.json",
          responseArtifactPath: "runs/pipe-1/full_extract/response-2.json",
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

  it("applies agent audit filters to LLM usage ledger queries", async () => {
    const calls: unknown[] = [];
    const store = getSupabaseAdminStore(
      supabaseClientReturningLlmUsage([], calls),
    );

    await store.getLlmUsageSummary({
      range: { key: "7d", label: "Last 7 days", startsAt: "2026-05-28T03:00:00.000Z" },
      startsAt: "2026-05-28T03:00:00.000Z",
      filters: {
        dataClass: "eval",
        provider: "dashscope",
        model: "qwen3-vl-plus",
        operation: "full_extract",
        status: "failed",
        sourceId: "source-1",
        articleBundleId: "bundle-1",
      },
    });

    expect(calls).toEqual(
      expect.arrayContaining([
        ["eq", "data_class", "eval"],
        ["eq", "provider", "dashscope"],
        ["eq", "model", "qwen3-vl-plus"],
        ["eq", "operation", "full_extract"],
        ["eq", "status", "failed"],
        ["eq", "source_id", "source-1"],
        ["eq", "article_bundle_id", "bundle-1"],
      ]),
    );
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

  it("lists structured admin feedback rows with agent audit filters", async () => {
    const calls: unknown[] = [];
    const store = getSupabaseAdminStore(
      supabaseClientForAdminFeedback(
        [
          {
            feedback_id: "feedback-1",
            data_class: "production",
            feedback_type: "missing_qr",
            pipeline_run_id: "pipe-1",
            article_bundle_id: "bundle-1",
            draft_id: "draft-1",
            event_id: null,
            field_name: "registrationQrAssetId",
            old_value: null,
            corrected_value: "asset-qr-1",
            reason: "QR is visible in the source poster.",
            created_by: "operator@example.com",
            status: "open",
            metadata: { safe: "kept" },
            created_at: "2026-06-11T10:00:00.000Z",
            updated_at: "2026-06-11T10:00:00.000Z",
          },
        ],
        calls,
      ),
    );

    await expect(
      store.listFeedback({
        dataClass: "production",
        draftId: "draft-1",
        articleBundleId: "bundle-1",
        status: "open",
      }),
    ).resolves.toEqual([
      {
        id: "feedback-1",
        dataClass: "production",
        feedbackType: "missing_qr",
        pipelineRunId: "pipe-1",
        articleBundleId: "bundle-1",
        draftId: "draft-1",
        eventId: undefined,
        fieldName: "registrationQrAssetId",
        oldValue: undefined,
        correctedValue: "asset-qr-1",
        reason: "QR is visible in the source poster.",
        createdBy: "operator@example.com",
        status: "open",
        metadata: { safe: "kept" },
        createdAt: "2026-06-11T10:00:00.000Z",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    ]);
    expect(calls).toEqual(
      expect.arrayContaining([
        ["eq", "data_class", "production"],
        ["eq", "draft_id", "draft-1"],
        ["eq", "article_bundle_id", "bundle-1"],
        ["eq", "status", "open"],
        ["order", "created_at", false],
        ["limit", 200],
      ]),
    );
  });

  it("creates structured admin feedback without updating canonical state", async () => {
    const calls: unknown[] = [];
    const store = getSupabaseAdminStore(
      supabaseClientForAdminFeedback([], calls, {
        feedback_id: "feedback-created",
        data_class: "production",
        feedback_type: "wrong_time",
        pipeline_run_id: "pipe-1",
        article_bundle_id: "bundle-1",
        draft_id: "draft-1",
        event_id: "event-1",
        field_name: "startsAt",
        old_value: "2026-06-06T06:00:00.000Z",
        corrected_value: "2026-06-06T07:00:00.000Z",
        reason: "Human verified the poster time.",
        created_by: "operator@example.com",
        status: "open",
        metadata: {},
        created_at: "2026-06-11T10:00:00.000Z",
        updated_at: "2026-06-11T10:00:00.000Z",
      }),
    );

    await expect(
      store.createFeedback({
        dataClass: "production",
        feedbackType: "wrong_time",
        pipelineRunId: "pipe-1",
        articleBundleId: "bundle-1",
        draftId: "draft-1",
        eventId: "event-1",
        fieldName: "startsAt",
        oldValue: "2026-06-06T06:00:00.000Z",
        correctedValue: "2026-06-06T07:00:00.000Z",
        reason: "Human verified the poster time.",
        createdBy: "operator@example.com",
      }),
    ).resolves.toMatchObject({
      id: "feedback-created",
      feedbackType: "wrong_time",
      fieldName: "startsAt",
      status: "open",
    });

    expect(calls).toEqual(
      expect.arrayContaining([
        [
          "insert",
          expect.objectContaining({
            data_class: "production",
            feedback_type: "wrong_time",
            draft_id: "draft-1",
            event_id: "event-1",
            field_name: "startsAt",
            status: "open",
          }),
        ],
        ["select", "admin_feedback_ledger"],
        ["maybeSingle"],
      ]),
    );
    expect(calls).not.toContainEqual([
      "from",
      expect.stringMatching(/event_drafts|canonical_events/),
    ]);
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

function supabaseClientReturningEventDrafts(rows: unknown[], calls: unknown[] = []) {
  const query = {
    select() {
      return query;
    },
    eq(...args: unknown[]) {
      calls.push(["eq", ...args]);
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
  calls: unknown[] = [],
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
        eq(...args: unknown[]) {
          calls.push(["eq", ...args]);
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
      data_class: "production",
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

function supabaseClientForEvaluationRuns(
  calls: unknown[] = [],
  runOverrides: Record<string, unknown> = {},
) {
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
      validity: "valid",
      invalidated_reason: null,
      invalidated_at: null,
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
      ...runOverrides,
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

function supabaseClientForPipelineRuns(calls: unknown[] = []) {
  const rowsByTable: Record<string, unknown[]> = {
    pipeline_runs: [
      {
        run_id: "pipe-1",
        data_class: "production",
        source_kind: "article_bundle",
        source_id: "bundle-1",
        article_bundle_id: "bundle-1",
        case_id: "case-1",
        status: "completed",
        decision: "needs_review",
        reason: "Missing registration QR.",
        started_at: "2026-06-10T04:00:00.000Z",
        finished_at: "2026-06-10T04:00:04.000Z",
        metadata: {
          safe: "kept",
          prompt: "do not leak",
        },
        created_at: "2026-06-10T04:00:00.000Z",
      },
    ],
    pipeline_steps: [
      {
        step_id: "step-1",
        run_id: "pipe-1",
        step_order: 1,
        node_name: "full_extract",
        node_version: "v5",
        status: "completed",
        decision: "public_activity",
        reason: "Event fields extracted.",
        provider: "dashscope",
        model: "qwen3-vl-plus",
        prompt_version: "full-extract-v5",
        schema_version: "event-extract-v5",
        usage_id: "usage-1",
        input_artifact_ids: ["artifact-input"],
        output_artifact_ids: ["artifact-output"],
        validation_issues: [
          {
            code: "missing_registration_qr",
            safe: "kept",
            raw_response: "do not leak",
          },
        ],
        error_details: {
          nested: {
            safe: "kept",
            api_key: "secret",
          },
        },
        started_at: "2026-06-10T04:00:00.000Z",
        finished_at: "2026-06-10T04:00:03.000Z",
        latency_ms: 3000,
        created_at: "2026-06-10T04:00:00.000Z",
      },
    ],
    pipeline_artifacts: [
      {
        artifact_id: "artifact-output",
        run_id: "pipe-1",
        step_id: "step-1",
        data_class: "production",
        path: "runs/pipe-1/full_extract.json",
        kind: "extraction",
        hash: "sha256:abc",
        bucket: "eval-artifacts",
        metadata: {
          safe: "kept",
          token: "secret",
        },
        created_at: "2026-06-10T04:00:03.000Z",
      },
    ],
    pipeline_attempts: [
      {
        attempt_id: "attempt-1",
        run_id: "pipe-1",
        step_id: "step-1",
        attempt_number: 1,
        provider: "dashscope",
        model: "qwen3-vl-plus",
        prompt_version: "full-extract-v5",
        schema_version: "event-extract-v5",
        usage: {
          totalTokens: 1450,
          costMicroCny: 4200,
          authorization: "secret",
        },
        validator_issues: [
          {
            code: "missing_registration_qr",
            safe: "kept",
            raw_response: "do not leak",
          },
        ],
        reason: "Validator asked for review.",
        started_at: "2026-06-10T04:00:00.000Z",
        finished_at: "2026-06-10T04:00:03.000Z",
        latency_ms: 3000,
        created_at: "2026-06-10T04:00:00.000Z",
      },
    ],
  };

  return {
    from(table: string) {
      const query = {
        select() {
          calls.push(["select", table]);
          return query;
        },
        eq(column: string, value: string) {
          calls.push(["eq", table, column, value]);
          return query;
        },
        in(column: string, values: string[]) {
          calls.push(["in", table, column, values]);
          return query;
        },
        order(column: string) {
          calls.push(["order", table, column]);
          return query;
        },
        limit(count: number) {
          calls.push(["limit", table, count]);
          return Promise.resolve({ data: rowsByTable[table] ?? [], error: null });
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
    eq(column: string, value: string) {
      calls.push(["eq", column, value]);
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

function supabaseClientForAdminFeedback(
  rows: unknown[],
  calls: unknown[] = [],
  insertedRow?: unknown,
) {
  const query = {
    select() {
      calls.push(["select", "admin_feedback_ledger"]);
      return query;
    },
    eq(column: string, value: string) {
      calls.push(["eq", column, value]);
      return query;
    },
    order(column: string, options?: { ascending?: boolean }) {
      calls.push(["order", column, Boolean(options?.ascending)]);
      return query;
    },
    limit(count: number) {
      calls.push(["limit", count]);
      return Promise.resolve({ data: rows, error: null });
    },
    insert(payload: unknown) {
      calls.push(["insert", payload]);
      return query;
    },
    maybeSingle() {
      calls.push(["maybeSingle"]);
      return Promise.resolve({ data: insertedRow, error: null });
    },
  };

  return {
    from(table: string) {
      calls.push(["from", table]);
      expect(table).toBe("admin_feedback_ledger");
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
        const evidenceQuery = {
          select() {
            return evidenceQuery;
          },
          eq() {
            return evidenceQuery;
          },
          in() {
            return Promise.resolve({ data: [], error: null });
          },
        };
        return {
          select: evidenceQuery.select,
        };
      }
      let updateEqCount = 0;
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
          updateEqCount += 1;
          return updateEqCount >= 2
            ? Promise.resolve({ error: null })
            : query;
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
        const evidenceQuery = {
          select() {
            return evidenceQuery;
          },
          eq() {
            return evidenceQuery;
          },
          in() {
            return Promise.resolve({ data: evidenceRows, error: null });
          },
        };
        return {
          select: evidenceQuery.select,
        };
      }
      let updateEqCount = 0;
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
          updateEqCount += 1;
          return updateEqCount >= 2
            ? Promise.resolve({ error: null })
            : query;
        },
      };
      return query;
    },
  } as never;
}
