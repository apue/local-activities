import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  JsonRunStore,
  createLocalCollectorRuntime,
  formatConsoleHelp,
  handleConsoleRequest,
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
