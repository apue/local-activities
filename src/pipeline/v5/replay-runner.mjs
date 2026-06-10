import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadRegressionCorpus } from "../../../scripts/regression-corpus-replay.mjs";
import { buildCandidatePacket } from "./candidate-packet.mjs";
import { runCheapTriage } from "./cheap-triage.mjs";
import { cleanCapturedArticleBundle } from "./content-cleaner.mjs";
import { buildNodeResult, createPipelineContext } from "./contracts.mjs";
import {
  mockEditorPass,
  mockFullExtract,
  publishTraceFromEditor,
  validateMockExtraction,
} from "./mock-harnesses.mjs";
import { scoreNormalizedContent } from "./signal-scorer.mjs";

const refusedTargets = new Set(["live_wechat", "live_llm", "hosted_supabase", "production"]);
const defaultArtifactDir = path.resolve("tmp/v5-replay-runs");

export function createMemoryV5ReplayWriter() {
  const state = {
    artifacts: new Map(),
  };
  return {
    state,
    store: "memory",
    async writeArtifact(artifactPath, value) {
      state.artifacts.set(artifactPath, value);
    },
  };
}

export function createLocalV5ReplayWriter({ artifactDir } = {}) {
  if (!artifactDir) throw new Error("v5_replay_artifact_dir_required");
  const memory = createMemoryV5ReplayWriter();
  return {
    ...memory,
    store: "local",
    async writeArtifact(artifactPath, value) {
      await memory.writeArtifact(artifactPath, value);
      const filePath = path.join(artifactDir, artifactPath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
    },
  };
}

export async function runV5Replay({
  corpusDir,
  all = false,
  caseIds = [],
  store = "memory",
  artifactDir = defaultArtifactDir,
  writer,
  now = new Date(),
} = {}) {
  if (!corpusDir) throw new Error("v5_replay_corpus_dir_required");
  const corpus = await loadRegressionCorpus({ corpusDir });
  const selectedCases = selectCases({ cases: corpus.cases, all, caseIds });
  const replayWriter = writer ?? writerForStore({ store, artifactDir });
  const runId = `v5-replay-${timestampId(now)}`;
  const runPrefix = `runs/${runId}`;
  const cases = [];
  for (const caseItem of selectedCases) {
    cases.push(await replayCase({ caseItem, writer: replayWriter, runPrefix, runId, now }));
  }
  const summaryPath = `${runPrefix}/summary.json`;
  const summary = {
    ok: cases.every((item) => item.status === "completed"),
    store: replayWriter.store ?? store,
    runId,
    corpusVersion: corpus.manifest.version,
    caseCount: cases.length,
    artifactDir: (replayWriter.store ?? store) === "local" ? artifactDir : undefined,
    summaryPath,
    cases,
  };
  await replayWriter.writeArtifact(summaryPath, summary);
  return summary;
}

export function parseV5ReplayArgs(argv = []) {
  const options = {
    store: "local",
    artifactDir: defaultArtifactDir,
    caseIds: [],
    all: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--corpus-dir") {
      options.corpusDir = path.resolve(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--case") {
      options.caseIds.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--all") {
      options.all = true;
    } else if (arg === "--store") {
      options.store = requiredValue(argv, index, arg);
      if (!["memory", "local"].includes(options.store)) {
        throw new Error(`v5_replay_store_invalid:${options.store}`);
      }
      index += 1;
    } else if (arg === "--artifact-dir") {
      options.artifactDir = path.resolve(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--target") {
      const target = requiredValue(argv, index, arg);
      if (refusedTargets.has(target)) {
        throw new Error(`v5_replay_refuses_live_or_production_target:${target}`);
      }
      options.target = target;
      index += 1;
    } else if (arg === "--allow-live") {
      throw new Error("v5_replay_live_not_supported_in_phase1");
    } else {
      throw new Error(`v5_replay_arg_unknown:${arg}`);
    }
  }
  if (!options.all && options.caseIds.length === 0) {
    throw new Error("v5_replay_case_or_all_required");
  }
  return options;
}

async function replayCase({ caseItem, writer, runPrefix, runId, now }) {
  const context = createPipelineContext({
    dataClass: "test",
    runId,
    articleId: caseItem.case.id,
  });
  const casePrefix = `${runPrefix}/cases/${caseItem.case.id}`;
  const steps = [];
  const rawBundlePath = `${casePrefix}/raw-bundle.json`;
  const rawBundleArtifact = artifactPointer({
    artifactId: "raw-bundle",
    path: rawBundlePath,
    kind: "raw_bundle",
    value: caseItem.bundle,
  });
  await writer.writeArtifact(rawBundlePath, caseItem.bundle);

  const normalized = cleanCapturedArticleBundle(caseItem.bundle);
  const contentCleanerStep = await writeStep({
    writer,
    casePrefix,
    context,
    nodeName: "content_cleaner",
    decision: "normalized",
    reason: "Captured bundle normalized for V5 replay.",
    inputArtifacts: [rawBundleArtifact],
    outputName: "content-cleaner-output.json",
    outputKind: "normalized_content",
    output: normalized,
    now,
  });
  steps.push(contentCleanerStep);

  const signalScore = scoreNormalizedContent(normalized);
  const signalScorerStep = await writeStep({
    writer,
    casePrefix,
    context,
    nodeName: "signal_scorer",
    decision: signalScore.decision,
    reason: signalScore.reason,
    inputArtifacts: [contentCleanerStep.outputArtifact],
    outputName: "signal-scorer-output.json",
    outputKind: "signal_score",
    output: signalScore,
    now,
  });
  steps.push(signalScorerStep);

  const packet = buildCandidatePacket({ normalized, signalScore });
  const candidatePacketStep = await writeStep({
    writer,
    casePrefix,
    context,
    nodeName: "candidate_packet",
    decision: "packet_built",
    reason: "Candidate packet built for cheap triage.",
    inputArtifacts: [contentCleanerStep.outputArtifact, signalScorerStep.outputArtifact],
    outputName: "candidate-packet-output.json",
    outputKind: "candidate_packet",
    output: packet,
    now,
  });
  steps.push(candidatePacketStep);

  const triage = await runCheapTriage({ packet, context, now });
  const cheapTriageStep = await writeStep({
    writer,
    casePrefix,
    context,
    nodeName: "cheap_triage",
    decision: triage.decision,
    reason: triage.reason,
    inputArtifacts: [candidatePacketStep.outputArtifact],
    outputName: "cheap-triage-output.json",
    outputKind: "cheap_triage_result",
    output: triage,
    attempts: triage.attempts,
    usage: triage.usage,
    now,
  });
  steps.push(cheapTriageStep);

  const extraction = mockFullExtract({
    normalized,
    packet,
    triage,
    expected: caseItem.expected,
    now,
  });
  const mockFullExtractStep = await writeStep({
    writer,
    casePrefix,
    context,
    nodeName: "mock_full_extract",
    decision: extraction.decision,
    reason: extraction.reason,
    inputArtifacts: [
      contentCleanerStep.outputArtifact,
      candidatePacketStep.outputArtifact,
      cheapTriageStep.outputArtifact,
    ],
    outputName: "mock-full-extract-output.json",
    outputKind: "extraction_result",
    output: extraction,
    attempts: extraction.attempts,
    usage: extraction.usage,
    now,
  });
  steps.push(mockFullExtractStep);

  const validation = validateMockExtraction({ extraction, normalized, now });
  const deterministicValidatorStep = await writeStep({
    writer,
    casePrefix,
    context,
    nodeName: "deterministic_validator",
    decision: validation.status,
    reason: `Validation status: ${validation.status}`,
    inputArtifacts: [mockFullExtractStep.outputArtifact],
    outputName: "deterministic-validator-output.json",
    outputKind: "validation_result",
    output: validation,
    validationIssues: validation.issues,
    now,
  });
  steps.push(deterministicValidatorStep);

  const editor = mockEditorPass({ normalized, extraction, validation, now });
  const mockEditorPassStep = await writeStep({
    writer,
    casePrefix,
    context,
    nodeName: "mock_editor_pass",
    decision: editor.editorDecision,
    reason: editor.reason,
    inputArtifacts: [
      contentCleanerStep.outputArtifact,
      mockFullExtractStep.outputArtifact,
      deterministicValidatorStep.outputArtifact,
    ],
    outputName: "mock-editor-pass-output.json",
    outputKind: "editor_result",
    output: editor,
    attempts: editor.attempts,
    usage: editor.usage,
    validationIssues: editor.qualityIssues,
    now,
  });
  steps.push(mockEditorPassStep);

  const publishTrace = publishTraceFromEditor({ extraction, validation, editor });
  const publishTraceStep = await writeStep({
    writer,
    casePrefix,
    context,
    nodeName: "publish_trace",
    decision: publishTrace.state,
    reason: publishTrace.reasons.join("; ") || "publish trace complete",
    inputArtifacts: [
      mockFullExtractStep.outputArtifact,
      deterministicValidatorStep.outputArtifact,
      mockEditorPassStep.outputArtifact,
    ],
    outputName: "publish-trace-output.json",
    outputKind: "publish_trace",
    output: publishTrace,
    now,
  });
  steps.push(publishTraceStep);

  return {
    caseId: caseItem.case.id,
    status: "completed",
    expectedAction: caseItem.expected.action,
    triageDecision: triage.decision,
    extractionDecision: extraction.decision,
    finalState: publishTrace.state,
    steps,
  };
}

async function writeStep({
  writer,
  casePrefix,
  context,
  nodeName,
  decision,
  reason,
  outputName,
  outputKind,
  output,
  inputArtifacts = [],
  attempts,
  usage,
  validationIssues = [],
  now,
}) {
  const outputPath = `${casePrefix}/${outputName}`;
  const outputArtifact = {
    artifactId: `${nodeName}-output`,
    path: outputPath,
    kind: outputKind,
    hash: hashJson(output),
  };
  const timestamp = isoTimestamp(now);
  await writer.writeArtifact(outputPath, output);
  const step = buildNodeResult({
    nodeName,
    nodeVersion: "v5-phase1",
    context,
    startedAt: timestamp,
    finishedAt: timestamp,
    status: "completed",
    decision,
    reason,
    inputArtifacts,
    outputArtifacts: [outputArtifact],
    externalCalls: [],
    usage,
    attempts,
    validationIssues,
  });
  const stepPath = `${casePrefix}/${nodeName}-step.json`;
  const stepArtifact = {
    artifactId: `${nodeName}-step`,
    path: stepPath,
    kind: "pipeline_step",
    hash: hashJson(step),
  };
  const stepSummary = {
    nodeName,
    decision,
    reason,
    status: "completed",
    inputArtifacts,
    outputArtifact,
    stepArtifact,
  };
  await writer.writeArtifact(stepPath, step);
  return stepSummary;
}

function artifactPointer({ artifactId, path, kind, value }) {
  return {
    artifactId,
    path,
    kind,
    hash: hashJson(value),
  };
}

function writerForStore({ store, artifactDir }) {
  if (store === "memory") return createMemoryV5ReplayWriter();
  if (store === "local") return createLocalV5ReplayWriter({ artifactDir });
  throw new Error(`v5_replay_store_invalid:${store}`);
}

function selectCases({ cases, all, caseIds }) {
  if (all) return cases.filter((item) => item.bundle);
  const selected = [];
  for (const caseId of caseIds) {
    const item = cases.find((candidate) => candidate.case.id === caseId);
    if (!item) throw new Error(`v5_replay_case_unknown:${caseId}`);
    if (!item.bundle) throw new Error(`v5_replay_case_has_no_bundle:${caseId}`);
    selected.push(item);
  }
  return selected;
}

function hashJson(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function timestampId(value) {
  return isoTimestamp(value).replace(/[^0-9]/g, "").slice(0, 14);
}

function isoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value ?? Date.now());
  if (!Number.isFinite(date.getTime())) throw new Error("v5_replay_now_invalid");
  return date.toISOString();
}

function requiredValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing_value:${arg}`);
  return value;
}
