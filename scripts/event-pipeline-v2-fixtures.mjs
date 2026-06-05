import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const requiredFixtureCases = [
  "beiping-beer-festival",
  "goethe-weekend-roundup",
  "goethe-weekly-library",
  "goethe-sonic-exhibition",
  "official-visit-news",
  "korean-red-flavor",
  "italian-monthly-roundup",
  "qr-registration-poster",
];

export const requiredFixtureFiles = [
  "source.json",
  "raw-wechat2rss.json",
  "article-snapshot.json",
  "image-candidates.json",
  "evidence-assets.json",
  "triage-input.json",
  "triage-response.json",
  "triage-decision.json",
  "extraction-input.json",
  "extraction-response.json",
  "extracted-event-candidates.json",
  "candidate-events.json",
  "resolution-response.json",
  "expected.json",
];

export const replayStages = ["snapshot", "triage", "extraction", "resolution"];

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultFixturesDir = path.resolve(
  moduleDir,
  "..",
  "fixtures",
  "event-pipeline-v2",
);

export async function loadFixtureCase({
  caseId,
  fixturesDir = defaultFixturesDir,
}) {
  if (!caseId) throw new Error("fixture_case_required");

  const caseDir = path.join(fixturesDir, caseId);
  const files = {};
  for (const fileName of requiredFixtureFiles) {
    const filePath = path.join(caseDir, fileName);
    try {
      files[fileName] = JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`fixture_file_missing:${caseId}:${fileName}`);
      }
      throw new Error(`fixture_file_invalid:${caseId}:${fileName}`);
    }
  }

  validateFixtureCase(caseId, files);
  return {
    caseId,
    caseDir,
    files,
  };
}

export async function replayFixtureStage(input) {
  const fixture = await loadFixtureCase(input);
  assertOfflineReplayTarget(input);

  if (!replayStages.includes(input.stage)) {
    throw new Error(`fixture_stage_unknown:${input.stage ?? ""}`);
  }

  if (input.stage === "snapshot") return replaySnapshot(fixture);
  if (input.stage === "triage") return replayTriage(fixture);
  if (input.stage === "extraction") return replayExtraction(fixture);
  return replayResolution(fixture);
}

export async function runFixtureE2E({
  caseId,
  all = false,
  fixturesDir = defaultFixturesDir,
  target,
} = {}) {
  assertOfflineReplayTarget({ target });
  const caseIds = all ? requiredFixtureCases : [caseId].filter(Boolean);
  if (caseIds.length === 0) throw new Error("fixture_case_required");

  const cases = [];
  for (const id of caseIds) {
    const fixture = await loadFixtureCase({ caseId: id, fixturesDir });
    const result = validateExpectedOutcome(fixture);
    cases.push(result);
  }

  return {
    ok: true,
    caseCount: cases.length,
    cases,
  };
}

export function assertOfflineReplayTarget({ target } = {}) {
  if (target === "hosted_supabase" || target === "production") {
    throw new Error("fixture_replay_refuses_hosted_supabase_write");
  }
}

export function formatFixtureResult(result) {
  return JSON.stringify(result, null, 2);
}

export function parseFixtureArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--case") {
      args.caseId = argv[index + 1];
      index += 1;
    } else if (arg === "--stage") {
      args.stage = argv[index + 1];
      index += 1;
    } else if (arg === "--all") {
      args.all = true;
    } else if (arg === "--target") {
      args.target = argv[index + 1];
      index += 1;
    } else if (arg === "--allow-live") {
      args.allowLive = true;
    } else if (arg === "--allow-hosted-write") {
      args.allowHostedWrite = true;
    } else if (arg === "--allow-public-fixture-data") {
      args.allowPublicFixtureData = true;
    } else if (arg === "--url") {
      args.url = argv[index + 1];
      index += 1;
    } else if (arg === "--env-file") {
      args.envFile = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

export async function runReplayCli(argv = process.argv.slice(2)) {
  const args = parseFixtureArgs(argv);
  const result = await replayFixtureStage(args);
  console.log(formatFixtureResult(result));
  return result;
}

export async function runE2ECli(argv = process.argv.slice(2)) {
  const args = parseFixtureArgs(argv);
  const result = await runFixtureE2E(args);
  console.log(formatFixtureResult(result));
  return result;
}

export async function runCaptureCli(argv = process.argv.slice(2)) {
  const args = parseFixtureArgs(argv);
  if (!args.allowLive) {
    throw new Error("fixture_capture_requires_operator_approval");
  }
  if (!args.caseId || !args.url) {
    throw new Error("fixture_capture_case_and_url_required");
  }
  return {
    ok: true,
    operatorRun: true,
    caseId: args.caseId,
    url: args.url,
  };
}

function replaySnapshot(fixture) {
  const snapshot = fixture.files["article-snapshot.json"];
  return {
    ok: true,
    caseId: fixture.caseId,
    stage: "snapshot",
    snapshot: {
      canonicalUrl: snapshot.canonicalUrl,
      title: snapshot.title,
      imageCount: fixture.files["image-candidates.json"].images.length,
      evidenceCount: fixture.files["evidence-assets.json"].assets.length,
    },
  };
}

function replayTriage(fixture) {
  const decision = fixture.files["triage-decision.json"];
  const response = fixture.files["triage-response.json"];
  return {
    ok: true,
    caseId: fixture.caseId,
    stage: "triage",
    recordedProvider: response.provider,
    decision,
    route:
      decision.triageAction === "exclude" ? "excluded_article" : "extraction",
  };
}

function replayExtraction(fixture) {
  const decision = fixture.files["triage-decision.json"];
  if (decision.triageAction === "exclude") {
    return {
      ok: true,
      caseId: fixture.caseId,
      stage: "extraction",
      skipped: true,
      reason: "triage_excluded_article",
    };
  }

  const candidates = fixture.files["extracted-event-candidates.json"].events;
  return {
    ok: true,
    caseId: fixture.caseId,
    stage: "extraction",
    eventCount: candidates.length,
    events: candidates,
  };
}

function replayResolution(fixture) {
  return {
    ok: true,
    caseId: fixture.caseId,
    stage: "resolution",
    decisions: fixture.files["resolution-response.json"].decisions,
  };
}

function validateFixtureCase(caseId, files) {
  const source = files["source.json"];
  const expected = files["expected.json"];
  if (source.caseId !== caseId) {
    throw new Error(`fixture_case_id_mismatch:${caseId}`);
  }
  if (expected.caseId !== caseId) {
    throw new Error(`fixture_expected_case_id_mismatch:${caseId}`);
  }
  if (!Array.isArray(files["image-candidates.json"].images)) {
    throw new Error(`fixture_images_invalid:${caseId}`);
  }
  if (!Array.isArray(files["evidence-assets.json"].assets)) {
    throw new Error(`fixture_evidence_invalid:${caseId}`);
  }
  if (!Array.isArray(files["extracted-event-candidates.json"].events)) {
    throw new Error(`fixture_extracted_events_invalid:${caseId}`);
  }
  if (!Array.isArray(files["candidate-events.json"].events)) {
    throw new Error(`fixture_candidate_events_invalid:${caseId}`);
  }
  if (!Array.isArray(files["resolution-response.json"].decisions)) {
    throw new Error(`fixture_resolution_invalid:${caseId}`);
  }
}

function validateExpectedOutcome(fixture) {
  const expected = fixture.files["expected.json"];
  const triage = replayTriage(fixture);
  const extraction = replayExtraction(fixture);
  const resolution = replayResolution(fixture);

  if (triage.route !== expected.route) {
    throw new Error(`fixture_route_mismatch:${fixture.caseId}`);
  }
  if (expected.expectedDraftCount !== undefined) {
    const count = extraction.skipped ? 0 : extraction.eventCount;
    if (count !== expected.expectedDraftCount) {
      throw new Error(`fixture_draft_count_mismatch:${fixture.caseId}`);
    }
  }
  if (expected.expectedResolutionDecision) {
    const decisions = resolution.decisions.map((decision) => decision.decision);
    if (!decisions.includes(expected.expectedResolutionDecision)) {
      throw new Error(`fixture_resolution_mismatch:${fixture.caseId}`);
    }
  }
  if (expected.expectedScheduleKind && !extraction.skipped) {
    const scheduleKinds = extraction.skipped
      ? []
      : extraction.events.map((event) => event.scheduleKind);
    if (!scheduleKinds.includes(expected.expectedScheduleKind)) {
      throw new Error(`fixture_schedule_kind_mismatch:${fixture.caseId}`);
    }
  }
  if (expected.requiresQrEvidence) {
    const assets = fixture.files["evidence-assets.json"].assets;
    if (!assets.some((asset) => asset.kind === "registration_qr")) {
      throw new Error(`fixture_qr_evidence_missing:${fixture.caseId}`);
    }
  }
  if (expected.expectedPublicEligibility) {
    const eligibilities = extraction.skipped
      ? [fixture.files["triage-decision.json"].publicEligibility]
      : extraction.events.map((event) => event.publicEligibility);
    if (!eligibilities.includes(expected.expectedPublicEligibility)) {
      throw new Error(`fixture_public_eligibility_mismatch:${fixture.caseId}`);
    }
  }

  return {
    caseId: fixture.caseId,
    route: triage.route,
    draftCount: extraction.skipped ? 0 : extraction.eventCount,
    resolutionDecisions: resolution.decisions.map(
      (decision) => decision.decision,
    ),
  };
}
