import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  JsonRunStore,
  createLocalCollectorRuntime,
  formatConsoleHelp,
  handleConsoleRequest,
  pollVercelJobOnce,
  processNextRun,
  readConsoleConfig,
} from "./local-collector-console.mjs";

describe("local collector console runtime", () => {
  it("persists local seed runs without storing secrets", async () => {
    const filePath = await tempRunFile();
    const store = new JsonRunStore({ filePath });

    const run = await store.enqueue({
      seedUrl: "https://mp.weixin.qq.com/s/example",
      now: new Date("2026-05-28T10:00:00.000Z"),
    });
    const reloaded = new JsonRunStore({ filePath });

    expect(run).toMatchObject({
      id: "local-20260528100000000-001",
      seedUrl: "https://mp.weixin.qq.com/s/example",
      state: "queued",
    });
    expect((await reloaded.list()).map((entry) => entry.id)).toEqual([run.id]);
    expect(await readFile(filePath, "utf8")).not.toContain("collector-secret");
  });

  it("claims a Vercel job into the local queue without duplicating it", async () => {
    const store = new JsonRunStore({ filePath: await tempRunFile() });
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse({
        job: {
          jobId: "job-1",
          seedUrl: "https://mp.weixin.qq.com/s/job",
          requestedAt: "2026-05-28T10:00:00.000Z",
          leaseExpiresAt: "2026-05-28T10:10:00.000Z",
          attemptNumber: 1,
        },
      });
    };
    const runtime = createRuntime({ store, fetchImpl });

    const first = await pollVercelJobOnce({
      runtime,
      now: new Date("2026-05-28T10:01:00.000Z"),
    });
    const second = await pollVercelJobOnce({
      runtime,
      now: new Date("2026-05-28T10:02:00.000Z"),
    });
    const runs = await store.list();

    expect(first).toMatchObject({
      kind: "claimed",
      jobId: "job-1",
      runId: runs[0].id,
      nextDelayMs: 0,
    });
    expect(second).toMatchObject({
      kind: "local-busy",
      reason: "queued",
      runId: runs[0].id,
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      source: "vercel_job",
      seedUrl: "https://mp.weixin.qq.com/s/job",
      state: "queued",
      vercelJob: {
        jobId: "job-1",
        attemptNumber: 1,
      },
    });
    expect(calls[0]).toMatchObject({
      url: "https://local-activities.example/api/collector/jobs/claim",
      body: {
        collectorId: "home-1",
        maxJobs: 1,
      },
    });
    expect(calls[0].init.headers.authorization).toBe("Bearer collector-secret");
    expect(await readFile(store.filePath, "utf8")).not.toContain(
      "collector-secret",
    );
  });

  it("does not claim Vercel jobs while local work is queued or active", async () => {
    const queuedStore = new JsonRunStore({ filePath: await tempRunFile() });
    await queuedStore.enqueue({
      seedUrl: "https://mp.weixin.qq.com/s/local",
      now: new Date("2026-05-28T10:00:00.000Z"),
    });
    const activeStore = new JsonRunStore({ filePath: await tempRunFile() });
    const active = await activeStore.enqueue({
      seedUrl: "https://mp.weixin.qq.com/s/active",
      now: new Date("2026-05-28T10:00:00.000Z"),
    });
    await activeStore.transition(active.id, "uploading", {
      now: new Date("2026-05-28T10:01:00.000Z"),
    });
    const fetchImpl = vi.fn(async () => jsonResponse({ job: null }));

    const queuedResult = await pollVercelJobOnce({
      runtime: createRuntime({ store: queuedStore, fetchImpl }),
      now: new Date("2026-05-28T10:02:00.000Z"),
    });
    const activeResult = await pollVercelJobOnce({
      runtime: createRuntime({ store: activeStore, fetchImpl }),
      now: new Date("2026-05-28T10:02:00.000Z"),
    });

    expect(queuedResult).toMatchObject({
      kind: "local-busy",
      reason: "queued",
      nextDelayMs: 60000,
    });
    expect(activeResult).toMatchObject({
      kind: "local-busy",
      reason: "active",
      nextDelayMs: 60000,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("heartbeats and reports a claimed Vercel job after fixture processing", async () => {
    const store = new JsonRunStore({ filePath: await tempRunFile() });
    const run = await store.enqueueVercelJob({
      job: {
        jobId: "job-1",
        seedUrl: "https://mp.weixin.qq.com/s/job",
        requestedAt: "2026-05-28T10:00:00.000Z",
        leaseExpiresAt: "2026-05-28T10:10:00.000Z",
        attemptNumber: 1,
      },
      now: new Date("2026-05-28T10:01:00.000Z"),
    });
    const heartbeat = vi.fn(async () => ({ ok: true }));
    const report = vi.fn(async () => ({ ok: true }));
    const processor = vi.fn(async () => ({
      kind: "uploaded",
      runId: run.id,
      uploadedIds: {
        sourceRunId: "source-1",
        articleSnapshotId: "article-1",
        eventDraftId: "draft-1",
      },
    }));

    const result = await processNextRun({
      store,
      processor,
      heartbeat,
      report,
      now: new Date("2026-05-28T10:02:00.000Z"),
    });

    expect(result).toMatchObject({ id: run.id, state: "uploaded" });
    expect(heartbeat.mock.calls.map(([input]) => input)).toMatchObject([
      { jobId: "job-1", localRunId: run.id, stage: "capturing" },
      { jobId: "job-1", localRunId: run.id, stage: "extracting" },
      { jobId: "job-1", localRunId: run.id, stage: "uploading" },
    ]);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        localRunId: run.id,
        status: "completed",
        sourceRunId: "source-1",
        articleSnapshotIds: ["article-1"],
        eventDraftIds: ["draft-1"],
        suggestedDisposition: "ready_for_review",
      }),
    );
    expect(processor).toHaveBeenCalledWith(
      expect.objectContaining({
        seedUrl: "https://mp.weixin.qq.com/s/job",
        localRunId: run.id,
        vercelJobId: "job-1",
      }),
    );
  });

  it("runs claim, heartbeat, fixture upload, and report through mocked Vercel APIs", async () => {
    const store = new JsonRunStore({ filePath: await tempRunFile() });
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      if (url.endsWith("/api/collector/jobs/claim")) {
        return jsonResponse({
          job: {
            jobId: "job-1",
            seedUrl: "https://mp.weixin.qq.com/s/job",
            requestedAt: "2026-05-28T10:00:00.000Z",
            leaseExpiresAt: "2026-05-28T10:10:00.000Z",
            attemptNumber: 1,
          },
        });
      }
      if (url.endsWith("/heartbeat") || url.endsWith("/report")) {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };
    const runtime = createRuntime({ store, fetchImpl });

    await pollVercelJobOnce({
      runtime,
      now: new Date("2026-05-28T10:01:00.000Z"),
    });
    const processed = await processNextRun({
      ...runtime,
      now: new Date("2026-05-28T10:02:00.000Z"),
    });

    expect(processed).toMatchObject({ state: "uploaded" });
    expect(calls.map((call) => call.url)).toEqual([
      "https://local-activities.example/api/collector/jobs/claim",
      "https://local-activities.example/api/collector/jobs/job-1/heartbeat",
      "https://local-activities.example/api/collector/jobs/job-1/heartbeat",
      "https://local-activities.example/api/collector/jobs/job-1/heartbeat",
      "https://local-activities.example/api/collector/source-run",
      "https://local-activities.example/api/collector/article-snapshot",
      "https://local-activities.example/api/collector/event-draft",
      "https://local-activities.example/api/collector/jobs/job-1/report",
    ]);
    expect(calls.at(-1).body).toMatchObject({
      collectorId: "home-1",
      localRunId: processed.id,
      status: "completed",
      sourceRunId: "id-5",
      articleSnapshotIds: ["id-6"],
      eventDraftIds: ["id-7"],
      suggestedDisposition: "ready_for_review",
    });
    expect(JSON.stringify(calls.map((call) => call.body))).not.toContain(
      "collector-secret",
    );
  });

  it("reports Vercel job failure when processing fails", async () => {
    const store = new JsonRunStore({ filePath: await tempRunFile() });
    const run = await store.enqueueVercelJob({
      job: {
        jobId: "job-1",
        seedUrl: "https://mp.weixin.qq.com/s/job",
        requestedAt: "2026-05-28T10:00:00.000Z",
        leaseExpiresAt: "2026-05-28T10:10:00.000Z",
        attemptNumber: 1,
      },
      now: new Date("2026-05-28T10:01:00.000Z"),
    });
    const report = vi.fn(async () => ({ ok: true }));

    const result = await processNextRun({
      store,
      processor: async () => {
        throw new Error("agent_config_missing");
      },
      heartbeat: async () => ({ ok: true }),
      report,
      now: new Date("2026-05-28T10:02:00.000Z"),
    });

    expect(result).toMatchObject({
      id: run.id,
      state: "failed",
      failureReason: "agent_config_missing",
    });
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        localRunId: run.id,
        status: "failed",
        suggestedDisposition: "failed",
        message: "agent_config_missing",
      }),
    );
  });

  it("reports uploaded structured failures as failed Vercel jobs", async () => {
    const store = new JsonRunStore({ filePath: await tempRunFile() });
    const run = await store.enqueueVercelJob({
      job: {
        jobId: "job-1",
        seedUrl: "https://mp.weixin.qq.com/s/job",
        requestedAt: "2026-05-28T10:00:00.000Z",
        leaseExpiresAt: "2026-05-28T10:10:00.000Z",
        attemptNumber: 1,
      },
      now: new Date("2026-05-28T10:01:00.000Z"),
    });
    const report = vi.fn(async () => ({ ok: true }));

    const result = await processNextRun({
      store,
      processor: async () => ({
        kind: "uploaded",
        runId: run.id,
        uploadedIds: {
          sourceRunId: "source-1",
          failureId: "failure-1",
        },
      }),
      heartbeat: async () => ({ ok: true }),
      report,
      now: new Date("2026-05-28T10:02:00.000Z"),
    });

    expect(result).toMatchObject({ id: run.id, state: "uploaded" });
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        localRunId: run.id,
        status: "failed",
        failureIds: ["failure-1"],
        suggestedDisposition: "failed",
      }),
    );
  });

  it("runs the agent processor from local runtime configuration", async () => {
    const store = new JsonRunStore({ filePath: await tempRunFile() });
    await store.enqueue({
      seedUrl: "https://mp.weixin.qq.com/s/text",
      now: new Date("2026-05-28T10:00:00.000Z"),
    });
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      if (url === "https://agent.example/v1/extract") {
        return jsonResponse({
          status: "success",
          disposition: "ready_for_review",
          confidence: 0.9,
          articleSnapshot: {
            canonicalUrl: "https://mp.weixin.qq.com/s/text",
            finalUrl: "https://mp.weixin.qq.com/s/text",
            capturedAt: "2026-05-28T10:00:00.000Z",
            languageHints: ["zh-CN"],
            captureMode: "text_complete",
            evidenceAssetIds: [],
            contentHash: "hash-agent",
          },
          eventDraft: {
            articleUrl: "https://mp.weixin.qq.com/s/text",
            extractionAttemptId: "agent-runtime-agent",
            disposition: "ready_for_review",
            captureMode: "text_complete",
            title: "Agent Runtime Event",
            organizer: "Official Cultural Center",
            startsAt: "2026-06-06T06:00:00.000Z",
            timezone: "Asia/Shanghai",
            city: "Beijing",
            reservationStatus: "unknown",
            signals: ["ready_for_review"],
            evidenceAssetIds: [],
            fieldEvidence: { title: ["visibleText"] },
            confidence: 0.9,
          },
        });
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };
    const runtime = createLocalCollectorRuntime({
      store,
      config: readConsoleConfig({
        COLLECTOR_BASE_URL: "https://local-activities.example",
        COLLECTOR_ID: "home-1",
        COLLECTOR_API_KEY: "collector-secret",
        LOCAL_COLLECTOR_PROCESSOR: "agent",
        AGENT_API_BASE_URL: "https://agent.example/v1",
        AGENT_API_KEY: "agent-secret",
        AGENT_MODEL: "agent-model",
      }),
    });
    runtime.config.fetchImpl = fetchImpl;
    runtime.config.env = {
      ...runtime.config.env,
      COLLECTOR_BASE_URL: "https://local-activities.example",
      COLLECTOR_ID: "home-1",
      COLLECTOR_API_KEY: "collector-secret",
      AGENT_API_BASE_URL: "https://agent.example/v1",
      AGENT_API_KEY: "agent-secret",
      AGENT_MODEL: "agent-model",
    };

    const result = await processNextRun({
      ...runtime,
      now: new Date("2026-05-28T10:01:00.000Z"),
    });

    expect(result).toMatchObject({
      state: "uploaded",
      uploadedIds: {
        sourceRunId: "id-2",
        articleSnapshotId: "id-3",
        eventDraftId: "id-4",
      },
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://agent.example/v1/extract",
      "https://local-activities.example/api/collector/source-run",
      "https://local-activities.example/api/collector/article-snapshot",
      "https://local-activities.example/api/collector/event-draft",
    ]);
    expect(JSON.stringify(calls.map((call) => call.body))).not.toContain(
      "agent-secret",
    );
  });

  it("rejects the superseded extract processor as a production local path", () => {
    expect(() =>
      readConsoleConfig({
        COLLECTOR_BASE_URL: "https://local-activities.example",
        COLLECTOR_ID: "home-1",
        COLLECTOR_API_KEY: "collector-secret",
        LOCAL_COLLECTOR_PROCESSOR: "extract",
      }),
    ).toThrow("unsupported_local_collector_processor:extract");
  });

  it("records no-job and network poll status without exposing secrets", async () => {
    const store = new JsonRunStore({ filePath: await tempRunFile() });
    const runtime = createRuntime({
      store,
      fetchImpl: async () => jsonResponse({ job: null, retryAfterSeconds: 120 }),
    });

    const noJob = await pollVercelJobOnce({
      runtime,
      now: new Date("2026-05-28T10:00:00.000Z"),
    });
    runtime.config.fetchImpl = async () => {
      throw new Error("network_down");
    };
    const error = await pollVercelJobOnce({
      runtime,
      now: new Date("2026-05-28T10:01:00.000Z"),
    });
    const health = await requestJson(
      runtime,
      new Request("http://127.0.0.1:4317/health"),
    );

    expect(noJob).toMatchObject({
      kind: "no-job",
      retryAfterSeconds: 120,
      nextDelayMs: 120000,
    });
    expect(error).toMatchObject({
      kind: "error",
      error: "network_down",
      nextDelayMs: 60000,
    });
    expect(health.body.polling).toMatchObject({
      lastKind: "error",
      lastError: "network_down",
    });
    expect(JSON.stringify(health.body)).not.toContain("collector-secret");
  });

  it("processes one queued run through fixture upload states", async () => {
    const filePath = await tempRunFile();
    const store = new JsonRunStore({ filePath });
    await store.enqueue({
      seedUrl: "https://mp.weixin.qq.com/s/example",
      now: new Date("2026-05-28T10:00:00.000Z"),
    });
    const processor = vi.fn(async () => ({
      kind: "uploaded",
      runId: "fixture-local",
      uploadedIds: { sourceRunId: "source-1", eventDraftId: "draft-1" },
    }));

    const result = await processNextRun({
      store,
      processor,
      now: new Date("2026-05-28T10:01:00.000Z"),
    });
    const saved = await store.get(result.id);

    expect(processor).toHaveBeenCalledWith(
      expect.objectContaining({
        seedUrl: "https://mp.weixin.qq.com/s/example",
        localRunId: result.id,
      }),
    );
    expect(saved.state).toBe("uploaded");
    expect(saved.uploadedIds).toEqual({
      sourceRunId: "source-1",
      eventDraftId: "draft-1",
    });
    expect(saved.history.map((entry) => entry.state)).toEqual([
      "queued",
      "capturing",
      "extracting",
      "uploading",
      "uploaded",
    ]);
  });

  it("does not start another queued run while one run is active", async () => {
    const filePath = await tempRunFile();
    const store = new JsonRunStore({ filePath });
    const active = await store.enqueue({
      seedUrl: "https://mp.weixin.qq.com/s/active",
      now: new Date("2026-05-28T10:00:00.000Z"),
    });
    await store.transition(active.id, "uploading", {
      now: new Date("2026-05-28T10:01:00.000Z"),
    });
    const queued = await store.enqueue({
      seedUrl: "https://mp.weixin.qq.com/s/queued",
      now: new Date("2026-05-28T10:02:00.000Z"),
    });
    const processor = vi.fn(async () => ({
      kind: "uploaded",
      runId: "fixture-local",
      uploadedIds: { sourceRunId: "source-1" },
    }));

    const result = await processNextRun({
      store,
      processor,
      now: new Date("2026-05-28T10:03:00.000Z"),
    });

    expect(result).toEqual({ kind: "busy", activeRunId: active.id });
    expect(processor).not.toHaveBeenCalled();
    expect(await store.get(queued.id)).toMatchObject({ state: "queued" });
  });

  it("marks a run failed when processing throws", async () => {
    const filePath = await tempRunFile();
    const store = new JsonRunStore({ filePath });
    const run = await store.enqueue({
      seedUrl: "https://mp.weixin.qq.com/s/example",
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    await expect(
      processNextRun({
        store,
        processor: async () => {
          throw new Error("agent_config_missing");
        },
        now: new Date("2026-05-28T10:01:00.000Z"),
      }),
    ).resolves.toMatchObject({ id: run.id, state: "failed" });

    await expect(store.get(run.id)).resolves.toMatchObject({
      state: "failed",
      failureReason: "agent_config_missing",
    });
  });

  it("serves local API and status responses without exposing configured secrets", async () => {
    const runtime = createLocalCollectorRuntime({
      store: new JsonRunStore({ filePath: await tempRunFile() }),
      config: {
        host: "127.0.0.1",
        port: 4317,
        processor: "fixture",
        baseUrl: "https://local-activities.example",
        collectorId: "home-1",
        collectorApiKey: "collector-secret",
        consoleToken: undefined,
      },
    });

    const created = await requestJson(
      runtime,
      new Request("http://127.0.0.1:4317/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seedUrl: "https://mp.weixin.qq.com/s/example" }),
      }),
    );
    const health = await requestJson(
      runtime,
      new Request("http://127.0.0.1:4317/health"),
    );
    const runs = await requestJson(
      runtime,
      new Request("http://127.0.0.1:4317/runs"),
    );

    expect(created.status).toBe(201);
    expect(created.body.run).toMatchObject({ state: "queued" });
    expect(health.body).toMatchObject({ ok: true, queueDepth: 1 });
    expect(runs.body.runs).toHaveLength(1);
    expect(JSON.stringify({ created, health, runs })).not.toContain(
      "collector-secret",
    );
  });

  it("renders a run detail page for browser inspection", async () => {
    const store = new JsonRunStore({ filePath: await tempRunFile() });
    const runtime = createLocalCollectorRuntime({
      store,
      config: {
        host: "127.0.0.1",
        port: 4317,
        processor: "fixture",
        baseUrl: "https://local-activities.example",
        collectorId: "home-1",
        collectorApiKey: "collector-secret",
        consoleToken: undefined,
      },
    });
    const run = await store.enqueue({
      seedUrl: "https://mp.weixin.qq.com/s/detail",
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    const response = await handleConsoleRequest(
      new Request(`http://127.0.0.1:4317/runs/${run.id}`, {
        headers: { accept: "text/html" },
      }),
      runtime,
    );
    const html = await response.text();

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain(run.id);
    expect(html).toContain("queued");
    expect(html).not.toContain("collector-secret");
  });

  it("redirects browser form submissions to the run detail page", async () => {
    const runtime = createLocalCollectorRuntime({
      store: new JsonRunStore({ filePath: await tempRunFile() }),
      config: {
        host: "127.0.0.1",
        port: 4317,
        processor: "fixture",
        baseUrl: "https://local-activities.example",
        collectorId: "home-1",
        collectorApiKey: "collector-secret",
        consoleToken: undefined,
      },
    });

    const response = await handleConsoleRequest(
      new Request("http://127.0.0.1:4317/runs", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "text/html",
        },
        body: new URLSearchParams({
          seedUrl: "https://mp.weixin.qq.com/s/form",
        }),
      }),
      runtime,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(
      /^\/runs\/local-\d+-001$/,
    );
  });

  it("can cancel queued runs and retry failed runs", async () => {
    const store = new JsonRunStore({ filePath: await tempRunFile() });
    const runtime = createLocalCollectorRuntime({
      store,
      config: {
        host: "127.0.0.1",
        port: 4317,
        processor: "fixture",
        baseUrl: "https://local-activities.example",
        collectorId: "home-1",
        collectorApiKey: "collector-secret",
        consoleToken: undefined,
      },
    });
    const queued = await store.enqueue({
      seedUrl: "https://mp.weixin.qq.com/s/cancel",
      now: new Date("2026-05-28T10:00:00.000Z"),
    });
    const failed = await store.enqueue({
      seedUrl: "https://mp.weixin.qq.com/s/retry",
      now: new Date("2026-05-28T10:01:00.000Z"),
    });
    await store.transition(failed.id, "failed", {
      now: new Date("2026-05-28T10:02:00.000Z"),
      patch: { failureReason: "agent_config_missing" },
    });

    const cancelled = await requestJson(
      runtime,
      new Request(`http://127.0.0.1:4317/runs/${queued.id}/cancel`, {
        method: "POST",
      }),
    );
    const retried = await requestJson(
      runtime,
      new Request(`http://127.0.0.1:4317/runs/${failed.id}/retry`, {
        method: "POST",
      }),
    );

    expect(cancelled.body.run).toMatchObject({ state: "cancelled" });
    expect(retried.body.run).toMatchObject({
      state: "queued",
      attemptNumber: 2,
    });
    expect(retried.body.run).not.toHaveProperty("failureReason");
  });

  it("requires the local console token when configured", async () => {
    const runtime = createLocalCollectorRuntime({
      store: new JsonRunStore({ filePath: await tempRunFile() }),
      config: {
        host: "0.0.0.0",
        port: 4317,
        processor: "fixture",
        baseUrl: "https://local-activities.example",
        collectorId: "home-1",
        collectorApiKey: "collector-secret",
        consoleToken: "local-console-secret",
      },
    });

    const denied = await handleConsoleRequest(
      new Request("http://192.168.0.16:4317/health"),
      runtime,
    );
    const allowed = await handleConsoleRequest(
      new Request("http://192.168.0.16:4317/health", {
        headers: { authorization: "Bearer local-console-secret" },
      }),
      runtime,
    );

    expect(denied.status).toBe(401);
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).not.toContain("local-console-secret");
  });

  it("rejects LAN binding without an explicit console token", () => {
    expect(() =>
      readConsoleConfig({
        COLLECTOR_CONSOLE_HOST: "0.0.0.0",
        LOCAL_COLLECTOR_PROCESSOR: "fixture",
        COLLECTOR_BASE_URL: "https://local-activities.example",
        COLLECTOR_ID: "home-1",
        COLLECTOR_API_KEY: "collector-secret",
      }),
    ).toThrow("missing_local_console_token_for_lan_bind");

    expect(() =>
      readConsoleConfig({
        COLLECTOR_CONSOLE_HOST: "127.0.0.1",
        LOCAL_COLLECTOR_PROCESSOR: "fixture",
        COLLECTOR_BASE_URL: "https://local-activities.example",
        COLLECTOR_API_KEY: "collector-secret",
      }),
    ).toThrow("missing_collector_id");

    expect(
      readConsoleConfig({
        COLLECTOR_CONSOLE_HOST: "127.0.0.1",
        LOCAL_COLLECTOR_PROCESSOR: "fixture",
        COLLECTOR_BASE_URL: "https://local-activities.example",
        COLLECTOR_ID: "home-1",
        COLLECTOR_API_KEY: "collector-secret",
      }),
    ).toMatchObject({ host: "127.0.0.1", port: 4317 });
  });

  it("documents collector console startup requirements", () => {
    const help = formatConsoleHelp();

    expect(help).toContain("pnpm collector:console");
    expect(help).toContain("LOCAL_COLLECTOR_PROCESSOR=fixture");
    expect(help).toContain("LOCAL_COLLECTOR_PROCESSOR=agent");
    expect(help).toContain("AGENT_API_BASE_URL");
    expect(help).toContain("COLLECTOR_POLLING_ENABLED");
    expect(help).toContain("COLLECTOR_POLL_INTERVAL_SECONDS");
    expect(help).toContain("COLLECTOR_CAPABILITIES");
    expect(help).toContain("LOCAL_COLLECTOR_CONSOLE_TOKEN");
    expect(help).toContain("127.0.0.1");
  });
});

async function tempRunFile() {
  const dir = await mkdtemp(path.join(tmpdir(), "collector-console-"));
  return path.join(dir, "runs.json");
}

async function requestJson(runtime, request) {
  const response = await handleConsoleRequest(request, runtime);
  return {
    status: response.status,
    body: await response.json(),
  };
}

function createRuntime({ store, fetchImpl }) {
  return createLocalCollectorRuntime({
    store,
    config: {
      host: "127.0.0.1",
      port: 4317,
      processor: "fixture",
      baseUrl: "https://local-activities.example",
      collectorId: "home-1",
      collectorApiKey: "collector-secret",
      consoleToken: undefined,
      capabilities: ["agent_api"],
      fetchImpl,
      polling: {
        enabled: true,
        idlePollMs: 60000,
        errorPollMs: 60000,
      },
      env: {
        COLLECTOR_BASE_URL: "https://local-activities.example",
        COLLECTOR_API_KEY: "collector-secret",
        COLLECTOR_ID: "home-1",
      },
    },
  });
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}
