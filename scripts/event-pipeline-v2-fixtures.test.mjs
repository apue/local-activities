import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertOfflineReplayTarget,
  loadFixtureCase,
  requiredFixtureCases,
  requiredFixtureFiles,
  replayFixtureStage,
  runCaptureCli,
  runFixtureE2E,
} from "./event-pipeline-v2-fixtures.mjs";

describe("Event Pipeline V2 fixture replay", () => {
  it("defines the required fixture case and file contract", () => {
    expect(requiredFixtureCases).toEqual([
      "beiping-beer-festival",
      "goethe-weekend-roundup",
      "goethe-weekly-library",
      "goethe-sonic-exhibition",
      "official-visit-news",
      "korean-red-flavor",
      "italian-monthly-roundup",
      "qr-registration-poster",
    ]);
    expect(requiredFixtureFiles).toContain("triage-response.json");
    expect(requiredFixtureFiles).toContain("resolution-response.json");
    expect(requiredFixtureFiles).toContain("expected.json");
  });

  it("loads committed fixtures and validates required files", async () => {
    const fixture = await loadFixtureCase({
      caseId: "goethe-weekly-library",
    });

    expect(fixture.files["source.json"]).toMatchObject({
      caseId: "goethe-weekly-library",
    });
    expect(fixture.files["triage-response.json"].provider).toBe("recorded");
  });

  it("replays stages independently from recorded responses", async () => {
    await expect(
      replayFixtureStage({
        caseId: "official-visit-news",
        stage: "triage",
      }),
    ).resolves.toMatchObject({
      stage: "triage",
      route: "excluded_article",
      decision: {
        triageDecision: "official_visit",
        triageAction: "exclude",
      },
    });

    await expect(
      replayFixtureStage({
        caseId: "goethe-sonic-exhibition",
        stage: "extraction",
      }),
    ).resolves.toMatchObject({
      stage: "extraction",
      eventCount: 1,
      events: [expect.objectContaining({ scheduleKind: "long_running" })],
    });
  });

  it("runs all committed cases through deterministic fixture E2E", async () => {
    await expect(runFixtureE2E({ all: true })).resolves.toMatchObject({
      ok: true,
      caseCount: requiredFixtureCases.length,
      cases: expect.arrayContaining([
        expect.objectContaining({
          caseId: "beiping-beer-festival",
          resolutionDecisions: ["same_event"],
        }),
        expect.objectContaining({
          caseId: "official-visit-news",
          route: "excluded_article",
          draftCount: 0,
        }),
      ]),
    });
  });

  it("replays a single case by name", async () => {
    await expect(
      runFixtureE2E({ caseId: "qr-registration-poster" }),
    ).resolves.toMatchObject({
      ok: true,
      caseCount: 1,
      cases: [
        expect.objectContaining({
          caseId: "qr-registration-poster",
          draftCount: 1,
        }),
      ],
    });
  });

  it("refuses hosted Supabase write targets in default replay", async () => {
    expect(() =>
      assertOfflineReplayTarget({ target: "hosted_supabase" }),
    ).toThrow("fixture_replay_refuses_hosted_supabase_write");
    await expect(
      runFixtureE2E({ caseId: "korean-red-flavor", target: "production" }),
    ).rejects.toThrow("fixture_replay_refuses_hosted_supabase_write");
  });

  it("requires explicit operator approval for live capture", async () => {
    await expect(
      runCaptureCli([
        "--case",
        "korean-red-flavor",
        "--url",
        "https://mp.weixin.qq.com/s/example",
      ]),
    ).rejects.toThrow("fixture_capture_requires_operator_approval");
  });

  it("reports missing fixture files with the case and file name", async () => {
    const fixturesDir = await createMinimalFixtureDirectory({
      caseId: "missing-file-case",
      omitFile: "expected.json",
    });

    await expect(
      loadFixtureCase({ caseId: "missing-file-case", fixturesDir }),
    ).rejects.toThrow("fixture_file_missing:missing-file-case:expected.json");
  });
});

async function createMinimalFixtureDirectory({ caseId, omitFile }) {
  const fixturesDir = path.join(os.tmpdir(), `event-pipeline-v2-${Date.now()}`);
  await mkdir(fixturesDir, { recursive: true });
  const caseDir = path.join(fixturesDir, caseId);
  await mkdir(caseDir, { recursive: true });
  for (const fileName of requiredFixtureFiles) {
    if (fileName === omitFile) continue;
    await writeFile(
      path.join(caseDir, fileName),
      JSON.stringify(minimalFile(caseId, fileName)),
    );
  }
  return fixturesDir;
}

function minimalFile(caseId, fileName) {
  if (fileName === "source.json") return { caseId };
  if (fileName === "image-candidates.json") return { images: [] };
  if (fileName === "evidence-assets.json") return { assets: [] };
  if (fileName === "extracted-event-candidates.json") return { events: [] };
  if (fileName === "candidate-events.json") return { events: [] };
  if (fileName === "resolution-response.json") return { decisions: [] };
  if (fileName === "expected.json") return { caseId, route: "extraction" };
  return {};
}
