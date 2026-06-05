import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildProductionSeedPlan,
  formatProductionSeedReport,
  loadProductionSeedManifest,
  runProductionSeedImport,
  validateProductionSeedManifest,
} from "./production-seed-events.mjs";

const manifestPath = "tests/seed-corpus/production-seed-manifest.json";

describe("production seed events", () => {
  it("loads the committed manifest and verifies required coverage", async () => {
    const manifest = await loadProductionSeedManifest(manifestPath);
    const plan = buildProductionSeedPlan(manifest);

    expect(plan.caseCount).toBeGreaterThanOrEqual(9);
    expect(plan.liveImportCaseCount).toBeGreaterThanOrEqual(3);
    expect(plan.coverage.qr_registration).toContain(
      "us-center-qr-lecture-2026-06",
    );
    expect(plan.coverage.duplicate_pair).toHaveLength(2);
    expect(plan.cases.map((item) => item.sourceUrl).join("\n")).not.toContain(
      "fixture",
    );
  });

  it("rejects manifests without complete coverage or a duplicate pair", () => {
    expect(() =>
      validateProductionSeedManifest({
        version: "production-seed-manifest-v1",
        batchLabel: "bad",
        cases: [minimalSeedCase({ coverage: ["single_event"] })],
      }),
    ).toThrow("seed_manifest_missing_coverage");
  });

  it("rejects fixture or placeholder source URLs", () => {
    expect(() =>
      validateProductionSeedManifest({
        version: "production-seed-manifest-v1",
        batchLabel: "bad",
        cases: [
          minimalSeedCase({
            source: {
              type: "live_url",
              url: "https://mp.weixin.qq.com/s/goethe-fixture",
            },
          }),
        ],
      }),
    ).toThrow("seed_case_refuses_fixture_url");
  });

  it("builds a production dry-run plan without importing live URLs", async () => {
    const result = await runProductionSeedImport({
      argv: [
        "--manifest",
        manifestPath,
        "--target-base-url",
        "https://local-activities.vercel.app",
        "--run-id",
        "production-seed-dry-run",
      ],
      env: {},
      importLiveUrl: async () => {
        throw new Error("should_not_import_in_dry_run");
      },
    });

    expect(result).toMatchObject({
      ok: true,
      mode: "dry_run",
      runId: "production-seed-dry-run",
      plan: {
        unsupportedCaseCount: expect.any(Number),
      },
    });
    expect(formatProductionSeedReport(result)).toContain(
      "# Production Seed Import Dry Run",
    );
  });

  it("refuses production apply without the explicit seed approval phrase", async () => {
    await expect(
      runProductionSeedImport({
        argv: [
          "--manifest",
          manifestPath,
          "--apply",
          "--allow-hosted-write",
          "--confirm-target",
          "https://local-activities.vercel.app",
        ],
        env: {
          COLLECTOR_BASE_URL: "https://local-activities.vercel.app",
        },
      }),
    ).rejects.toThrow("production_seed_apply_requires_confirm_seed_import");
  });

  it("imports only live URL cases with production seed usage labels when approved", async () => {
    const manifest = {
      version: "production-seed-manifest-v1",
      batchLabel: "test-seed",
      cases: [
        minimalSeedCase({
          id: "live-a",
          coverage: [
            "single_event",
            "multi_event_article",
            "qr_registration",
            "poster_or_image_dominant",
            "long_running_exhibition",
            "recurring_activity",
            "duplicate_pair",
            "official_visit_or_non_public_news",
            "generic_non_event",
            "incomplete_review_case",
          ],
          source: {
            type: "live_url",
            url: "https://mp.weixin.qq.com/s/live-a",
          },
          expected: {
            action: "extract",
            public: true,
            publicEventCount: 1,
            duplicateGroup: "dupe",
          },
        }),
        minimalSeedCase({
          id: "captured-b",
          coverage: ["duplicate_pair"],
          source: {
            type: "captured_reference",
            articleUrl: "https://mp.weixin.qq.com/s?__biz=x&mid=1&idx=1&sn=2",
          },
          expected: {
            action: "extract",
            public: true,
            publicEventCount: 1,
            duplicateGroup: "dupe",
          },
        }),
      ],
    };
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "production-seed-"));
    const tempManifestPath = path.join(tempDir, "manifest.json");
    await writeFile(tempManifestPath, JSON.stringify(manifest), "utf8");
    const imports = [];

    const result = await runProductionSeedImport({
      argv: [
        "--manifest",
        tempManifestPath,
        "--apply",
        "--allow-hosted-write",
        "--confirm-seed-import",
        "IMPORT_PRODUCTION_SEED_EVENTS",
        "--confirm-target",
        "https://local-activities.vercel.app",
        "--target-base-url",
        "https://local-activities.vercel.app",
        "--run-id",
        "production-seed-test",
      ],
      env: {
        COLLECTOR_BASE_URL: "http://localhost:3000",
      },
      importLiveUrl: async (input) => {
        imports.push(input);
        return {
          runId: "wechat-url-run",
          articleTitle: "Live A",
          draftSummaries: [{ title: "Live A" }],
          failureSummaries: [],
          extraction: {
            uploadedEventDraftIds: ["draft-1"],
            uploadedLlmUsageIds: ["usage-1"],
          },
        };
      },
    });

    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({
      url: "https://mp.weixin.qq.com/s/live-a",
      upload: true,
      env: {
        USAGE_ENVIRONMENT: "production_seed_acceptance",
        PRODUCTION_SEED_USAGE_ENVIRONMENT: "production_seed_acceptance",
        COLLECTOR_BASE_URL: "https://local-activities.vercel.app",
        APP_BASE_URL: "https://local-activities.vercel.app",
      },
    });
    expect(result.imported).toEqual([
      expect.objectContaining({
        caseId: "live-a",
        draftCount: 1,
        uploadedLlmUsageIds: ["usage-1"],
      }),
    ]);
  });
});

function minimalSeedCase(overrides = {}) {
  return {
    id: overrides.id ?? "case-a",
    title: overrides.title ?? "Case A",
    coverage: overrides.coverage ?? ["single_event"],
    source: overrides.source ?? {
      type: "live_url",
      url: "https://mp.weixin.qq.com/s/live-a",
    },
    expected: overrides.expected ?? {
      action: "extract",
      public: true,
      publicEventCount: 1,
    },
  };
}
