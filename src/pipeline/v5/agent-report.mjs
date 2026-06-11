import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readAgentAuditPacket } from "./agent-audit.mjs";

const defaultOutputRoot = ".agent-runs";

const candidateModuleMap = {
  volume_shift: "collector/source-health",
  funnel_drop: "pipeline-orchestration",
  possible_duplicate_cluster: "dedupe",
  possible_update_misclassified_as_new: "dedupe",
  missing_evidence_assets: "storage/evidence-assets",
  provider_error_cluster: "model-provider/live-harness",
  public_visibility_gap: "public-events",
  usage_spike: "model-budget",
  review_backlog: "admin/review",
};

const severityRank = {
  high: 0,
  medium: 1,
  low: 2,
  info: 3,
};

export async function generateAgentAuditReport({
  auditDir,
  evalSummaryPath,
  comparisonPath,
  findingPaths = [],
  outputDir,
  now = new Date(),
} = {}) {
  if (
    !auditDir &&
    !evalSummaryPath &&
    !comparisonPath &&
    findingPaths.length === 0
  ) {
    throw new Error("agent_report_input_required");
  }
  const artifacts = await loadReportArtifacts({
    auditDir,
    evalSummaryPath,
    comparisonPath,
    findingPaths,
  });
  const report = buildAgentAuditReport({
    artifacts,
    inputPaths: {
      auditDir,
      evalSummaryPath,
      comparisonPath,
      findingPaths,
    },
    now,
  });
  const paths = await writeAgentAuditReport({
    report,
    outputDir:
      outputDir ?? path.join(defaultOutputRoot, `agent-report-${timestampId(now)}`),
  });
  return { report, paths };
}

export function buildAgentAuditReport({
  artifacts,
  inputPaths = {},
  now = new Date(),
} = {}) {
  const generatedAt = isoTimestamp(now);
  const auditPacket = artifacts?.auditPacket;
  const evalSummary = artifacts?.evalSummary;
  const comparison = artifacts?.comparison;
  const findingEvidence = artifacts?.findingEvidence ?? [];
  const candidates = [...(auditPacket?.candidateIndex?.candidates ?? [])]
    .sort(compareCandidates)
    .slice(0, 12);
  const evalFailCount = numberValue(evalSummary?.failCount);
  const comparisonFailedGates =
    comparison?.gates?.filter?.((gate) => !gate.passed) ?? [];
  const highSeverityCount = candidates.filter(
    (candidate) => candidate.severityHint === "high",
  ).length;
  const feedback = auditPacket?.auditFacts?.feedback ?? {};
  const evidenceLinks = buildEvidenceLinks({
    inputPaths,
    auditPacket,
    evalSummary,
    comparison,
    findingEvidence,
  });
  const suspectedAreas = buildSuspectedAreas({ candidates, evalSummary, comparison });
  const nextActions = buildNextActions({
    candidates,
    evalSummary,
    comparison,
    findingEvidence,
    evidenceLinks,
  });
  const summary = {
    status:
      highSeverityCount > 0 ||
      evalFailCount > 0 ||
      comparisonFailedGates.length > 0
        ? "attention_needed"
        : "ok",
    auditRunId: auditPacket?.runId,
    evalRunId: evalSummary?.runId ?? comparison?.runId,
    candidateCount: candidates.length,
    highSeverityCount,
    evalFailCount,
    falsePositiveCount: numberValue(evalSummary?.falsePositiveCount),
    falseNegativeCount: numberValue(evalSummary?.falseNegativeCount),
    openFeedbackCount: numberValue(feedback.openCount),
    feedbackCount: numberValue(feedback.totalCount),
    suspectedAreaCount: suspectedAreas.length,
    nextActionCount: nextActions.length,
  };
  const report = {
    kind: "agent_audit_report",
    generatedAt,
    summary,
    audit: summarizeAudit(auditPacket),
    evaluation: summarizeEvaluation(evalSummary, comparison),
    suspectedAreas,
    nextActions,
    evidenceLinks,
    uncertainty: {
      statement:
        "This report summarizes observable artifacts and proposes suspected areas; it is not a final root-cause judgment.",
      missingInputs: missingInputs(inputPaths),
    },
  };
  return {
    ...report,
    markdown: renderAgentAuditReportMarkdown(report),
  };
}

export async function writeAgentAuditReport({ report, outputDir } = {}) {
  if (!report) throw new Error("agent_report_required");
  if (!outputDir) throw new Error("agent_report_output_dir_required");
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "agent-report.json");
  const markdownPath = path.join(outputDir, "agent-report.md");
  const { markdown, ...jsonReport } = report;
  await writeFile(jsonPath, `${JSON.stringify(jsonReport, null, 2)}\n`);
  await writeFile(
    markdownPath,
    markdown ?? renderAgentAuditReportMarkdown(jsonReport),
  );
  return { jsonPath, markdownPath };
}

export async function resolveEvalArtifactPaths({
  evalRunId,
  evalArtifactDir = "tmp/v5-eval-runs",
} = {}) {
  if (!evalRunId) return {};
  const runDir = path.join(evalArtifactDir, "runs", evalRunId);
  const evalSummaryPath = path.join(runDir, "summary.json");
  const comparisonPath = path.join(runDir, "comparison.json");
  return {
    evalSummaryPath,
    comparisonPath: await fileExists(comparisonPath) ? comparisonPath : undefined,
  };
}

async function loadReportArtifacts({
  auditDir,
  evalSummaryPath,
  comparisonPath,
  findingPaths,
}) {
  const [auditPacket, evalSummary, comparison, findingEvidence] = await Promise.all([
    auditDir ? readAgentAuditPacket(auditDir) : undefined,
    evalSummaryPath ? readJson(evalSummaryPath) : undefined,
    comparisonPath ? readOptionalJson(comparisonPath) : undefined,
    Promise.all((findingPaths ?? []).map(readFindingEvidence)),
  ]);
  return {
    auditPacket,
    evalSummary,
    comparison,
    findingEvidence,
  };
}

async function readFindingEvidence(filePath) {
  const value = await readJson(filePath);
  return sanitizeFindingEvidence(value, filePath);
}

function sanitizeFindingEvidence(value, filePath) {
  return {
    kind: value?.kind,
    findingId: clean(value?.findingId ?? value?.candidate?.candidateId),
    candidateType: clean(value?.candidate?.candidateType),
    evidencePath: filePath,
    usageArtifactPaths: (value?.usageRecords ?? [])
      .map((row) => row.responseArtifactPath ?? row.requestArtifactPath)
      .filter(Boolean),
    articleBundleIds: (value?.sourceBundle?.articleBundles ?? [])
      .map((row) => row.articleBundleId)
      .filter(Boolean),
    dbRowCounts: Object.fromEntries(
      Object.entries(value?.dbRows ?? {}).map(([key, rows]) => [
        key,
        Array.isArray(rows) ? rows.length : 0,
      ]),
    ),
  };
}

function buildEvidenceLinks({
  inputPaths,
  auditPacket,
  evalSummary,
  comparison,
  findingEvidence,
}) {
  const links = [];
  if (inputPaths.auditDir) {
    links.push(
      link("audit facts", path.join(inputPaths.auditDir, "audit-facts.json")),
      link(
        "candidate index",
        path.join(inputPaths.auditDir, "candidate-index.json"),
      ),
      link(
        "public snapshot",
        path.join(inputPaths.auditDir, "public-snapshot.json"),
      ),
      link("usage summary", path.join(inputPaths.auditDir, "usage-summary.json")),
    );
  }
  if (inputPaths.evalSummaryPath) {
    links.push(link("eval summary", inputPaths.evalSummaryPath));
  }
  if (inputPaths.comparisonPath) {
    links.push(link("eval comparison", inputPaths.comparisonPath));
  }
  for (const artifactPath of evalSummary?.artifactPaths ?? []) {
    links.push(link("eval artifact", artifactPath));
  }
  for (const artifactPath of comparison?.artifactPaths ?? []) {
    links.push(link("comparison artifact", artifactPath));
  }
  for (const finding of findingEvidence ?? []) {
    if (finding.evidencePath) {
      links.push(
        link("finding evidence", finding.evidencePath, {
          findingId: finding.findingId,
        }),
      );
    }
    for (const artifactPath of finding.usageArtifactPaths ?? []) {
      links.push(link("LLM artifact", artifactPath, { findingId: finding.findingId }));
    }
  }
  if (auditPacket?.outputDir && !inputPaths.auditDir) {
    links.push(link("audit packet", auditPacket.outputDir));
  }
  return dedupeLinks(links);
}

function buildSuspectedAreas({ candidates, evalSummary, comparison }) {
  const areas = new Map();
  for (const candidate of candidates) {
    const module = moduleForCandidate(candidate);
    if (!areas.has(module)) {
      areas.set(module, {
        module,
        uncertainty: "medium",
        reasons: [],
        evidenceLinks: [],
      });
    }
    const area = areas.get(module);
    area.reasons.push(candidate.reason ?? `${candidate.candidateType} candidate`);
    if (candidate.drilldownCommand) {
      area.evidenceLinks.push({ label: "drilldown command", path: candidate.drilldownCommand });
    }
  }
  if (numberValue(evalSummary?.failCount) > 0) {
    areas.set("evaluation/regression-harness", {
      module: "evaluation/regression-harness",
      uncertainty: "low",
      reasons: [
        `${evalSummary.failCount} eval cases failed in ${
          evalSummary.runId ?? "latest eval"
        }.`,
      ],
      evidenceLinks: (evalSummary.artifactPaths ?? [])
        .slice(0, 5)
        .map((artifactPath) => link("eval artifact", artifactPath)),
    });
  }
  const failedGates = comparison?.gates?.filter?.((gate) => !gate.passed) ?? [];
  if (failedGates.length > 0) {
    areas.set("prompt-model-config/eval-gates", {
      module: "prompt-model-config/eval-gates",
      uncertainty: "low",
      reasons: failedGates.map((gate) => gate.reason ?? `${gate.name} failed`),
      evidenceLinks: (comparison.artifactPaths ?? [])
        .slice(0, 5)
        .map((artifactPath) => link("comparison artifact", artifactPath)),
    });
  }
  return [...areas.values()].map((area) => ({
    ...area,
    reasons: unique(area.reasons).slice(0, 5),
    evidenceLinks: dedupeLinks(area.evidenceLinks).slice(0, 6),
  }));
}

function buildNextActions({ candidates, evalSummary, comparison, findingEvidence }) {
  const actions = [];
  const findingById = new Map(
    (findingEvidence ?? []).map((finding) => [finding.findingId, finding]),
  );
  for (const candidate of candidates.slice(0, 8)) {
    const finding = findingById.get(candidate.candidateId);
    actions.push({
      actionId: `action-${String(actions.length + 1).padStart(3, "0")}`,
      priority: priorityForCandidate(candidate),
      title: titleForCandidate(candidate),
      suspectedModule: moduleForCandidate(candidate),
      rationale: candidate.reason ?? summarizeSignals(candidate.signals),
      uncertainty: "medium",
      evidenceLinks: dedupeLinks([
        candidate.drilldownCommand
          ? link("drilldown command", candidate.drilldownCommand)
          : undefined,
        finding?.evidencePath
          ? link("finding evidence", finding.evidencePath)
          : undefined,
        ...(finding?.usageArtifactPaths ?? []).map((artifactPath) =>
          link("LLM artifact", artifactPath),
        ),
      ].filter(Boolean)),
    });
  }
  if (numberValue(evalSummary?.failCount) > 0) {
    actions.push({
      actionId: `action-${String(actions.length + 1).padStart(3, "0")}`,
      priority: "high",
      title: `Review ${evalSummary.failCount} failing eval case(s)`,
      suspectedModule: "evaluation/regression-harness",
      rationale:
        "Regression output indicates model/prompt/pipeline behavior differs from expected corpus labels.",
      uncertainty: "low",
      evidenceLinks: (evalSummary.artifactPaths ?? [])
        .slice(0, 8)
        .map((artifactPath) => link("eval artifact", artifactPath)),
    });
  }
  const failedGates = comparison?.gates?.filter?.((gate) => !gate.passed) ?? [];
  if (failedGates.length > 0) {
    actions.push({
      actionId: `action-${String(actions.length + 1).padStart(3, "0")}`,
      priority: "high",
      title: "Do not activate candidate config until eval gates pass",
      suspectedModule: "prompt-model-config/eval-gates",
      rationale: failedGates.map((gate) => gate.reason ?? gate.name).join("; "),
      uncertainty: "low",
      evidenceLinks: (comparison.artifactPaths ?? [])
        .slice(0, 8)
        .map((artifactPath) => link("comparison artifact", artifactPath)),
    });
  }
  return actions;
}

function summarizeAudit(packet) {
  if (!packet) return undefined;
  const production = packet.auditFacts?.pipelineFunnel?.byDataClass?.production ?? {};
  return {
    runId: packet.runId,
    window: packet.auditFacts?.window,
    productionFunnel: {
      totalLedgerCount: numberValue(production.totalLedgerCount),
      publishedCount: numberValue(production.publishedCount),
      needsReviewCount: numberValue(production.needsReviewCount),
      excludedCount: numberValue(production.excludedCount),
      failedCount: numberValue(production.failedCount),
    },
    publicVisibility: packet.auditFacts?.publicVisibility,
    publicSnapshotCounts: packet.publicSnapshot?.counts,
    usageTotals: packet.usageSummary?.totals,
    candidateCount: packet.candidateIndex?.candidates?.length ?? 0,
  };
}

function summarizeEvaluation(evalSummary, comparison) {
  if (!evalSummary && !comparison) return undefined;
  return {
    runId: evalSummary?.runId ?? comparison?.runId,
    ok: evalSummary?.ok,
    recommended: comparison?.recommended,
    recommendation: comparison?.recommendation,
    corpusVersion: evalSummary?.corpusVersion ?? comparison?.corpusVersion,
    caseCount: numberValue(evalSummary?.caseCount ?? comparison?.caseCount),
    passCount: numberValue(evalSummary?.passCount),
    failCount: numberValue(evalSummary?.failCount),
    falsePositiveCount: numberValue(evalSummary?.falsePositiveCount),
    falseNegativeCount: numberValue(evalSummary?.falseNegativeCount),
    actionAccuracy: evalSummary?.actionAccuracy,
    finalStateAccuracy: evalSummary?.finalStateAccuracy,
    gates: comparison?.gates,
    regressions: comparison?.regressions,
  };
}

function renderAgentAuditReportMarkdown(report) {
  const lines = [
    "# Agent Audit Report",
    "",
    `Generated: ${report.generatedAt ?? "unknown"}`,
    `Status: ${report.summary?.status ?? "unknown"}`,
    "",
    "## Summary",
    "",
    `- Audit run: ${report.summary?.auditRunId ?? "not provided"}`,
    `- Eval run: ${report.summary?.evalRunId ?? "not provided"}`,
    `- Candidates: ${report.summary?.candidateCount ?? 0} (${
      report.summary?.highSeverityCount ?? 0
    } high)`,
    `- Eval failures: ${report.summary?.evalFailCount ?? 0}`,
    `- Feedback: ${report.summary?.openFeedbackCount ?? 0}/${
      report.summary?.feedbackCount ?? 0
    } open/total`,
    "",
    "## Suspected Areas",
    "",
    ...markdownSuspectedAreas(report.suspectedAreas ?? []),
    "",
    "## Next Actions",
    "",
    ...markdownNextActions(report.nextActions ?? []),
    "",
    "## Evidence Links",
    "",
    ...markdownEvidenceLinks(report.evidenceLinks ?? []),
    "",
    "## Uncertainty",
    "",
    report.uncertainty?.statement ??
      "This report is based on available artifacts only.",
  ];
  return `${lines.join("\n")}\n`;
}

function markdownSuspectedAreas(areas) {
  if (areas.length === 0) return ["- None from provided artifacts."];
  return areas.map((area) => {
    const reason = area.reasons?.[0] ?? "No reason provided.";
    return `- ${area.module} (${area.uncertainty} uncertainty): ${reason}`;
  });
}

function markdownNextActions(actions) {
  if (actions.length === 0) {
    return ["- No immediate action suggested by provided artifacts."];
  }
  return actions.map((action) => {
    const evidence = action.evidenceLinks?.[0]?.path
      ? ` Evidence: ${action.evidenceLinks[0].path}`
      : "";
    return `- [${action.priority}] ${action.title} -> ${action.suspectedModule}.${evidence}`;
  });
}

function markdownEvidenceLinks(links) {
  if (links.length === 0) return ["- No evidence links provided."];
  return links.slice(0, 30).map((item) => `- ${item.label}: ${item.path}`);
}

function compareCandidates(left, right) {
  const leftRank = severityRank[left.severityHint] ?? 9;
  const rightRank = severityRank[right.severityHint] ?? 9;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return String(left.candidateId ?? "").localeCompare(
    String(right.candidateId ?? ""),
  );
}

function priorityForCandidate(candidate) {
  return candidate.severityHint === "high" ? "high" : "medium";
}

function titleForCandidate(candidate) {
  return `Investigate ${candidate.candidateId ?? candidate.candidateType}`;
}

function moduleForCandidate(candidate) {
  return candidateModuleMap[candidate.candidateType] ?? "pipeline/unknown";
}

function summarizeSignals(signals) {
  if (!signals || typeof signals !== "object") return "Candidate was raised by audit signals.";
  return Object.entries(signals)
    .slice(0, 4)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
}

function missingInputs(inputPaths) {
  const missing = [];
  if (!inputPaths.auditDir) missing.push("audit-dir");
  if (!inputPaths.evalSummaryPath && !inputPaths.comparisonPath) {
    missing.push("eval-summary/comparison");
  }
  if ((inputPaths.findingPaths ?? []).length === 0) missing.push("finding evidence");
  return missing;
}

function link(label, artifactPath, extra = {}) {
  if (!artifactPath) return undefined;
  return {
    label,
    path: artifactPath,
    ...extra,
  };
}

function dedupeLinks(links) {
  const seen = new Set();
  return links.filter((item) => {
    if (!item?.path) return false;
    const key = `${item.label}:${item.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readOptionalJson(filePath) {
  if (!filePath) return undefined;
  if (!(await fileExists(filePath))) return undefined;
  return readJson(filePath);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function isoTimestamp(value) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function timestampId(value) {
  return isoTimestamp(value).replace(/[^0-9]/g, "").slice(0, 14);
}
