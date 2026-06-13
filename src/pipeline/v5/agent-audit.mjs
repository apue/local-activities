import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const defaultAgentAuditDataClasses = ["production", "eval", "test", "smoke"];

const candidateTypes = new Set([
  "volume_shift",
  "funnel_drop",
  "possible_duplicate_cluster",
  "possible_update_misclassified_as_new",
  "missing_evidence_assets",
  "provider_error_cluster",
  "public_visibility_gap",
  "usage_spike",
  "review_backlog",
  "review_exception_contract_gap",
  "likely_editor_false_negative",
]);

export async function buildAgentAuditPacket({
  store,
  days = 7,
  now = new Date(),
  dataClasses = defaultAgentAuditDataClasses,
  outputDir,
  monthlyBudgetCny = 100,
} = {}) {
  if (!store || typeof store !== "object") throw new Error("agent_audit_store_required");
  const normalizedDays = positiveInteger(days, "agent_audit_days_invalid");
  const generatedAt = isoTimestamp(now);
  const endsAt = generatedAt;
  const startsAt = isoTimestamp(new Date(new Date(endsAt).getTime() - normalizedDays * 24 * 60 * 60 * 1000));
  const normalizedDataClasses = normalizeDataClasses(dataClasses);

  const slices = [];
  for (const dataClass of normalizedDataClasses) {
    slices.push(await loadAuditSlice({ store, dataClass, startsAt, endsAt }));
  }

  const runId = `agent-audit-${timestampId(now)}`;
  const context = {
    runId,
    generatedAt,
    window: {
      days: normalizedDays,
      startsAt,
      endsAt,
    },
    dataClasses: normalizedDataClasses,
    outputDir,
  };
  const auditFacts = buildAuditFacts({ context, slices });
  const publicSnapshot = buildPublicSnapshot({ context, slices });
  const usageSummary = buildUsageSummary({ context, slices, monthlyBudgetCny });
  const candidateIndex = buildCandidateIndex({
    context,
    auditFacts,
    publicSnapshot,
    usageSummary,
  });
  const auditBrief = renderAuditBrief({
    context,
    auditFacts,
    publicSnapshot,
    usageSummary,
    candidateIndex,
  });

  return {
    runId,
    outputDir,
    auditFacts,
    candidateIndex,
    publicSnapshot,
    usageSummary,
    auditBrief,
  };
}

export async function writeAgentAuditPacket({ packet, outputDir } = {}) {
  if (!packet) throw new Error("agent_audit_packet_required");
  const dir = outputDir ?? packet.outputDir;
  if (!dir) throw new Error("agent_audit_output_dir_required");
  await mkdir(dir, { recursive: true });
  const paths = {
    auditFactsPath: path.join(dir, "audit-facts.json"),
    candidateIndexPath: path.join(dir, "candidate-index.json"),
    publicSnapshotPath: path.join(dir, "public-snapshot.json"),
    usageSummaryPath: path.join(dir, "usage-summary.json"),
    auditBriefPath: path.join(dir, "audit-brief.md"),
  };
  await writeJson(paths.auditFactsPath, packet.auditFacts);
  await writeJson(paths.candidateIndexPath, packet.candidateIndex);
  await writeJson(paths.publicSnapshotPath, packet.publicSnapshot);
  await writeJson(paths.usageSummaryPath, packet.usageSummary);
  await writeFile(paths.auditBriefPath, packet.auditBrief);
  return {
    ...paths,
    outputDir: dir,
  };
}

export async function readAgentAuditPacket(auditDir) {
  if (!auditDir) throw new Error("agent_audit_dir_required");
  const [auditFacts, candidateIndex, publicSnapshot, usageSummary, auditBrief] = await Promise.all([
    readJson(path.join(auditDir, "audit-facts.json")),
    readJson(path.join(auditDir, "candidate-index.json")),
    readJson(path.join(auditDir, "public-snapshot.json")),
    readJson(path.join(auditDir, "usage-summary.json")),
    readFile(path.join(auditDir, "audit-brief.md"), "utf8"),
  ]);
  return {
    runId: auditFacts.runId,
    outputDir: auditDir,
    auditFacts,
    candidateIndex,
    publicSnapshot,
    usageSummary,
    auditBrief,
  };
}

export async function inspectAgentFinding({
  findingId,
  auditDir,
  outputDir,
  now = new Date(),
} = {}) {
  if (!findingId) throw new Error("agent_audit_finding_id_required");
  return writeEvidencePack({
    evidence: await buildFindingEvidencePack({ findingId, auditDir, now }),
    outputDir,
  });
}

export async function inspectAgentCluster({
  clusterId,
  auditDir,
  outputDir,
  now = new Date(),
} = {}) {
  if (!clusterId) throw new Error("agent_audit_cluster_id_required");
  return writeEvidencePack({
    evidence: await buildFindingEvidencePack({ findingId: clusterId, auditDir, now, matchCluster: true }),
    outputDir,
  });
}

export async function inspectAgentEvent({
  eventId,
  auditDir,
  outputDir,
  now = new Date(),
} = {}) {
  if (!eventId) throw new Error("agent_audit_event_id_required");
  const packet = await readAgentAuditPacket(auditDir);
  const evidence = buildEntityEvidencePack({
    kind: "agent_audit_event_evidence",
    entityType: "event",
    entityId: eventId,
    packet,
    generatedAt: isoTimestamp(now),
    filter: (row) => row.eventId === eventId || row.canonicalEventId === eventId,
  });
  return writeEvidencePack({ evidence, outputDir });
}

export async function inspectAgentSource({
  sourceId,
  auditDir,
  outputDir,
  now = new Date(),
} = {}) {
  if (!sourceId) throw new Error("agent_audit_source_id_required");
  const packet = await readAgentAuditPacket(auditDir);
  const evidence = buildEntityEvidencePack({
    kind: "agent_audit_source_evidence",
    entityType: "source",
    entityId: sourceId,
    packet,
    generatedAt: isoTimestamp(now),
    filter: (row) => row.sourceId === sourceId,
  });
  return writeEvidencePack({ evidence, outputDir });
}

async function loadAuditSlice({ store, dataClass, startsAt, endsAt }) {
  const [
    sourceChannels,
    sourceRuns,
    collectorFailures,
    articleBundles,
    processingLedger,
    pipelineRuns,
    eventDrafts,
    publicEvents,
    feedback,
    llmUsageRecords,
  ] = await Promise.all([
    listFromStore(store, "listSourceChannels", { dataClass }),
    listFromStore(store, "listSourceRuns", { dataClass, startsAt, endsAt }),
    listFromStore(store, "listCollectorFailures", { dataClass, startsAt, endsAt }),
    listFromStore(store, "listArticleBundles", { dataClass, startsAt, endsAt }),
    listFromStore(store, "listProcessingLedger", { dataClass, startsAt, endsAt }),
    listFromStore(store, "listPipelineRuns", { dataClass, startsAt, endsAt }),
    listFromStore(store, "listEventDrafts", { dataClass }),
    listFromStore(store, "listPublicEvents", { dataClass }),
    listFromStore(store, "listFeedback", { dataClass, startsAt, endsAt }),
    listUsageRecords(store, { dataClass, startsAt, endsAt }),
  ]);
  return {
    dataClass,
    sourceChannels: sourceChannels.map(normalizeSourceChannel),
    sourceRuns: sourceRuns.map(normalizeSourceRun),
    collectorFailures: collectorFailures.map(normalizeCollectorFailure),
    articleBundles: articleBundles.map(normalizeArticleBundle),
    processingLedger: processingLedger.map(normalizeLedgerRow),
    pipelineRuns: pipelineRuns.map(normalizePipelineRun),
    eventDrafts: eventDrafts.map(normalizeDraftRow),
    publicEvents: publicEvents.map(normalizePublicEventRow),
    feedback: feedback.map(normalizeFeedbackRow),
    llmUsageRecords: llmUsageRecords.map(normalizeUsageRow),
  };
}

async function listUsageRecords(store, input) {
  if (typeof store.listLlmUsage === "function") {
    return store.listLlmUsage(input);
  }
  if (typeof store.getLlmUsageSummary === "function") {
    const summary = await store.getLlmUsageSummary({
      startsAt: input.startsAt,
      range: {
        key: "7d",
        label: "Audit window",
        startsAt: input.startsAt,
      },
      filters: {
        dataClass: input.dataClass,
      },
    });
    return summary?.recent ?? [];
  }
  return [];
}

async function listFromStore(store, method, input) {
  if (typeof store[method] !== "function") return [];
  return store[method](input);
}

function buildAuditFacts({ context, slices }) {
  const sourceChannels = slices.flatMap((slice) => slice.sourceChannels);
  const sourceRuns = slices.flatMap((slice) => slice.sourceRuns);
  const collectorFailures = slices.flatMap((slice) => slice.collectorFailures);
  const articleBundles = slices.flatMap((slice) => slice.articleBundles);
  const processingLedger = slices.flatMap((slice) => slice.processingLedger);
  const pipelineRuns = slices.flatMap((slice) => slice.pipelineRuns);
  const eventDrafts = slices.flatMap((slice) => slice.eventDrafts);
  const publicEvents = slices.flatMap((slice) => slice.publicEvents);
  const feedbackRecords = slices.flatMap((slice) => slice.feedback);
  const usageRecords = slices.flatMap((slice) => slice.llmUsageRecords);
  return {
    kind: "agent_audit_facts",
    runId: context.runId,
    generatedAt: context.generatedAt,
    window: context.window,
    dataClasses: context.dataClasses,
    sourceHealth: buildSourceHealth({
      sourceChannels,
      sourceRuns,
      collectorFailures,
      articleBundles,
      processingLedger,
      pipelineRuns,
    }),
    pipelineFunnel: buildPipelineFunnel(slices),
    reviewState: buildReviewState(slices),
    publicVisibility: buildPublicVisibility({ processingLedger, publicEvents }),
    feedback: {
      totalCount: feedbackRecords.length,
      openCount: feedbackRecords.filter((item) => item.status === "open").length,
      byType: countBy(feedbackRecords, "feedbackType"),
      records: feedbackRecords,
    },
    records: {
      sourceChannels,
      sourceRuns,
      collectorFailures,
      articleBundles,
      processingLedger,
      pipelineRuns,
      eventDrafts,
      publicEvents,
      feedback: feedbackRecords,
      llmUsage: usageRecords,
    },
  };
}

function buildPublicSnapshot({ context, slices }) {
  const productionEvents = slices
    .filter((slice) => slice.dataClass === "production")
    .flatMap((slice) => slice.publicEvents)
    .filter((event) => event.status === "published");
  const renderableEvents = productionEvents.filter(isPublicRenderableAuditEvent);
  return {
    kind: "agent_public_snapshot",
    runId: context.runId,
    generatedAt: context.generatedAt,
    dataClass: "production",
    counts: {
      publishedRows: productionEvents.length,
      publicRenderableRows: renderableEvents.length,
      missingPosterCount: renderableEvents.filter((event) => !event.posterImageUrl && !event.posterAssetId).length,
      missingRegistrationQrCount: renderableEvents.filter((event) => {
        return event.reservationStatus === "required" && !event.registrationQrImageUrl && !event.registrationQrAssetId;
      }).length,
    },
    events: renderableEvents,
  };
}

function buildUsageSummary({ context, slices, monthlyBudgetCny }) {
  const records = slices.flatMap((slice) => slice.llmUsageRecords);
  const totals = sumUsage(records);
  const windowBudgetCny = monthlyBudgetCny * (context.window.days / 30);
  return {
    kind: "agent_usage_summary",
    runId: context.runId,
    generatedAt: context.generatedAt,
    window: context.window,
    budget: {
      monthlyBudgetCny,
      windowBudgetCny,
      overWindowBudget: microCnyToCny(totals.costMicroCny) > windowBudgetCny,
    },
    totals,
    byDataClass: groupUsage(records, (row) => row.dataClass ?? "unknown"),
    byProviderModelOperation: groupUsage(records, (row) => {
      return [row.provider, row.model, row.operation].map((value) => value ?? "unknown").join(" / ");
    }),
    recentFailures: records
      .filter((row) => row.status === "failed")
      .slice(0, 50),
    records,
  };
}

function buildCandidateIndex({ context, auditFacts, publicSnapshot, usageSummary }) {
  const candidates = [
    ...volumeShiftCandidates({ context, auditFacts }),
    ...funnelDropCandidates({ auditFacts }),
    ...duplicateClusterCandidates({ publicSnapshot }),
    ...updateLikeCandidates({ publicSnapshot }),
    ...missingEvidenceCandidates({ publicSnapshot }),
    ...providerErrorCandidates({ usageSummary }),
    ...publicVisibilityGapCandidates({ auditFacts }),
    ...usageSpikeCandidates({ usageSummary }),
    ...reviewBacklogCandidates({ auditFacts }),
    ...reviewExceptionContractCandidates({ auditFacts }),
    ...likelyEditorFalseNegativeCandidates({ auditFacts }),
  ].map((candidate, index) => normalizeCandidate(candidate, index, context.outputDir));
  return {
    kind: "agent_candidate_index",
    runId: context.runId,
    generatedAt: context.generatedAt,
    candidates,
  };
}

function volumeShiftCandidates({ context, auditFacts }) {
  const production = auditFacts.pipelineFunnel.byDataClass.production ?? emptyFunnel();
  if (production.totalLedgerCount > 0 || production.pipelineRunCount > 0) return [];
  return [{
    candidateType: "volume_shift",
    severityHint: "medium",
    signals: {
      productionLedgerCount: production.totalLedgerCount,
      productionPipelineRunCount: production.pipelineRunCount,
      windowDays: context.window.days,
    },
    affectedSourceIds: [],
    affectedArticleIds: [],
    affectedEventIds: [],
    artifactPaths: [],
  }];
}

function funnelDropCandidates({ auditFacts }) {
  return Object.entries(auditFacts.pipelineFunnel.byDataClass)
    .filter(([, funnel]) => funnel.failedCount > 0 || funnel.needsReviewCount > funnel.publishedCount)
    .map(([dataClass, funnel]) => ({
      candidateType: "funnel_drop",
      severityHint: funnel.failedCount > 0 ? "high" : "medium",
      signals: {
        dataClass,
        failedCount: funnel.failedCount,
        needsReviewCount: funnel.needsReviewCount,
        publishedCount: funnel.publishedCount,
      },
      affectedSourceIds: sourceIdsForLedger(auditFacts.records.processingLedger, dataClass),
      affectedArticleIds: articleIdsForLedgerState(auditFacts.records.processingLedger, dataClass, ["failed", "needs_review"]),
      affectedEventIds: eventIdsForLedgerState(auditFacts.records.processingLedger, dataClass, ["published"]),
      artifactPaths: artifactPathsForRuns(auditFacts.records.pipelineRuns, { dataClass }),
    }));
}

function duplicateClusterCandidates({ publicSnapshot }) {
  const groups = groupBy(publicSnapshot.events, (event) => duplicateKey(event));
  return [...groups.entries()]
    .filter(([, events]) => events.length > 1)
    .map(([key, events]) => ({
      candidateType: "possible_duplicate_cluster",
      clusterId: `cluster-${shortHash(key)}`,
      severityHint: "medium",
      signals: {
        duplicateKey: key,
        eventCount: events.length,
        titles: events.map((event) => event.title),
      },
      affectedSourceIds: unique(events.map((event) => event.sourceId).filter(Boolean)),
      affectedArticleIds: unique(events.map((event) => event.articleBundleId).filter(Boolean)),
      affectedEventIds: events.map((event) => event.eventId),
      artifactPaths: [],
    }));
}

function updateLikeCandidates({ publicSnapshot }) {
  return publicSnapshot.events
    .filter((event) => /update|updated|更新|变更|调整|加场/i.test(`${event.title} ${event.summary ?? ""}`))
    .map((event) => ({
      candidateType: "possible_update_misclassified_as_new",
      severityHint: "low",
      signals: {
        title: event.title,
        sourceUrl: event.sourceUrl,
      },
      affectedSourceIds: [event.sourceId].filter(Boolean),
      affectedArticleIds: [event.articleBundleId].filter(Boolean),
      affectedEventIds: [event.eventId],
      artifactPaths: [],
    }));
}

function missingEvidenceCandidates({ publicSnapshot }) {
  return publicSnapshot.events
    .filter((event) => {
      const missingPoster = !event.posterImageUrl && !event.posterAssetId;
      const missingRegistration = event.reservationStatus === "required" &&
        !event.registrationUrl &&
        !event.registrationQrImageUrl &&
        !event.registrationQrAssetId;
      return missingPoster || missingRegistration;
    })
    .map((event) => ({
      candidateType: "missing_evidence_assets",
      severityHint: event.reservationStatus === "required" ? "high" : "medium",
      signals: {
        title: event.title,
        missingPoster: !event.posterImageUrl && !event.posterAssetId,
        missingRegistration: event.reservationStatus === "required" &&
          !event.registrationUrl &&
          !event.registrationQrImageUrl &&
          !event.registrationQrAssetId,
      },
      affectedSourceIds: [event.sourceId].filter(Boolean),
      affectedArticleIds: [event.articleBundleId].filter(Boolean),
      affectedEventIds: [event.eventId],
      artifactPaths: [],
    }));
}

function providerErrorCandidates({ usageSummary }) {
  const failures = usageSummary.records.filter((row) => row.status === "failed");
  const groups = groupBy(failures, (row) => {
    return [row.provider, row.model, row.operation, row.errorCode].map((value) => value ?? "unknown").join("|");
  });
  return [...groups.entries()].map(([key, rows]) => ({
    candidateType: "provider_error_cluster",
    clusterId: `cluster-${shortHash(key)}`,
    severityHint: rows.length >= 3 ? "high" : "medium",
    signals: {
      providerModelOperationError: key,
      failureCount: rows.length,
    },
    affectedSourceIds: unique(rows.map((row) => row.sourceId).filter(Boolean)),
    affectedArticleIds: unique(rows.map((row) => row.articleBundleId).filter(Boolean)),
    affectedEventIds: [],
    artifactPaths: unique(rows.flatMap((row) => [row.requestArtifactPath, row.responseArtifactPath].filter(Boolean))),
  }));
}

function publicVisibilityGapCandidates({ auditFacts }) {
  const publicEventIds = new Set(auditFacts.records.publicEvents.map((event) => event.eventId));
  const gaps = auditFacts.records.processingLedger.filter((row) => {
    return row.dataClass === "production" &&
      row.state === "published" &&
      row.canonicalEventId &&
      !publicEventIds.has(row.canonicalEventId);
  });
  if (gaps.length === 0) return [];
  return [{
    candidateType: "public_visibility_gap",
    severityHint: "high",
    signals: {
      gapCount: gaps.length,
      eventIds: unique(gaps.map((row) => row.canonicalEventId).filter(Boolean)),
    },
    affectedSourceIds: unique(gaps.map((row) => row.sourceId).filter(Boolean)),
    affectedArticleIds: unique(gaps.map((row) => row.articleBundleId).filter(Boolean)),
    affectedEventIds: unique(gaps.map((row) => row.canonicalEventId).filter(Boolean)),
    artifactPaths: [],
  }];
}

function usageSpikeCandidates({ usageSummary }) {
  if (!usageSummary.budget.overWindowBudget) return [];
  return [{
    candidateType: "usage_spike",
    severityHint: "high",
    signals: {
      costCny: microCnyToCny(usageSummary.totals.costMicroCny),
      windowBudgetCny: usageSummary.budget.windowBudgetCny,
      requestCount: usageSummary.totals.requestCount,
    },
    affectedSourceIds: unique(usageSummary.records.map((row) => row.sourceId).filter(Boolean)),
    affectedArticleIds: unique(usageSummary.records.map((row) => row.articleBundleId).filter(Boolean)),
    affectedEventIds: [],
    artifactPaths: unique(usageSummary.records.flatMap((row) => [row.requestArtifactPath, row.responseArtifactPath].filter(Boolean))),
  }];
}

function reviewBacklogCandidates({ auditFacts }) {
  const backlogDrafts = auditFacts.records.eventDrafts.filter(isReviewQueueDraft);
  if (backlogDrafts.length === 0) return [];
  return [{
    candidateType: "review_backlog",
    severityHint: backlogDrafts.length >= 10 ? "high" : "medium",
    signals: {
      backlogCount: backlogDrafts.length,
      byReviewState: countBy(backlogDrafts, "reviewState"),
    },
    affectedSourceIds: unique(backlogDrafts.map((draft) => draft.sourceId).filter(Boolean)),
    affectedArticleIds: unique(backlogDrafts.map((draft) => draft.articleBundleId).filter(Boolean)),
    affectedDraftIds: unique(backlogDrafts.map((draft) => draft.draftId).filter(Boolean)),
    affectedEventIds: unique(backlogDrafts.map((draft) => draft.canonicalEventId).filter(Boolean)),
    artifactPaths: [],
  }];
}

function reviewExceptionContractCandidates({ auditFacts }) {
  const gaps = auditFacts.records.eventDrafts.filter((draft) => {
    return isReviewQueueDraft(draft) && exceptionReasonCodesForDraft(draft).length === 0;
  });
  if (gaps.length === 0) return [];
  return [{
    candidateType: "review_exception_contract_gap",
    severityHint: "high",
    signals: {
      gapCount: gaps.length,
      byReviewState: countBy(gaps, "reviewState"),
      titles: gaps.map((draft) => draft.title).filter(Boolean).slice(0, 10),
    },
    affectedSourceIds: unique(gaps.map((draft) => draft.sourceId).filter(Boolean)),
    affectedArticleIds: unique(gaps.map((draft) => draft.articleBundleId).filter(Boolean)),
    affectedDraftIds: unique(gaps.map((draft) => draft.draftId).filter(Boolean)),
    affectedEventIds: unique(gaps.map((draft) => draft.canonicalEventId).filter(Boolean)),
    artifactPaths: [],
  }];
}

function likelyEditorFalseNegativeCandidates({ auditFacts }) {
  const drafts = auditFacts.records.eventDrafts.filter((draft) => {
    return isReviewQueueDraft(draft) &&
      exceptionReasonCodesForDraft(draft).length === 0 &&
      isLikelyPublicActivityDraft(draft);
  });
  if (drafts.length === 0) return [];
  return [{
    candidateType: "likely_editor_false_negative",
    severityHint: "high",
    signals: {
      candidateCount: drafts.length,
      titles: drafts.map((draft) => draft.title).filter(Boolean).slice(0, 10),
    },
    affectedSourceIds: unique(drafts.map((draft) => draft.sourceId).filter(Boolean)),
    affectedArticleIds: unique(drafts.map((draft) => draft.articleBundleId).filter(Boolean)),
    affectedDraftIds: unique(drafts.map((draft) => draft.draftId).filter(Boolean)),
    affectedEventIds: unique(drafts.map((draft) => draft.canonicalEventId).filter(Boolean)),
    artifactPaths: [],
  }];
}

function isReviewQueueDraft(draft) {
  return ["needs_review", "needs_info", "possible_duplicate", "ready_for_review"].includes(draft.reviewState);
}

function exceptionReasonCodesForDraft(draft) {
  return unique([
    ...(draft.exceptionReasonCodes ?? []),
    ...(draft.hardBlockers ?? []).map((blocker) => blocker.code),
    ...(draft.softBlockers ?? []).map((blocker) => blocker.code),
  ]);
}

function isLikelyPublicActivityDraft(draft) {
  const hasPublicTriage = ["public_activity", "possible_public_activity"].includes(draft.triageDecision);
  const hasRequiredFields = Boolean(
    draft.title &&
      draft.startsAt &&
      draft.organizer &&
      (draft.venueName || draft.venueAddress),
  );
  return hasPublicTriage &&
    hasRequiredFields &&
    draft.publicEligibility !== "not_public" &&
    !["news", "visit", "cancellation", "unsupported"].includes(draft.eventKind) &&
    draft.scheduleKind !== "unsupported" &&
    (draft.confidence ?? 0) >= 0.9;
}

function normalizeCandidate(candidate, index, outputDir) {
  if (!candidateTypes.has(candidate.candidateType)) {
    throw new Error(`agent_audit_candidate_type_invalid:${candidate.candidateType}`);
  }
  const candidateId = `finding-${String(index + 1).padStart(3, "0")}`;
  return {
    candidateId,
    candidateType: candidate.candidateType,
    clusterId: candidate.clusterId,
    severityHint: candidate.severityHint ?? "low",
    signals: plainObject(candidate.signals),
    affectedSourceIds: unique(candidate.affectedSourceIds ?? []),
    affectedArticleIds: unique(candidate.affectedArticleIds ?? []),
    affectedDraftIds: unique(candidate.affectedDraftIds ?? []),
    affectedEventIds: unique(candidate.affectedEventIds ?? []),
    artifactPaths: unique(candidate.artifactPaths ?? []),
    drilldownCommand: `pnpm agent:inspect-finding -- --finding-id ${candidateId} --output-dir ${path.join(outputDir ?? ".agent-runs/<run-id>", "evidence")}`,
  };
}

async function buildFindingEvidencePack({ findingId, auditDir, now, matchCluster = false }) {
  const packet = await readAgentAuditPacket(auditDir);
  const candidate = findCandidate(packet.candidateIndex.candidates, findingId, matchCluster);
  if (!candidate) throw new Error(`agent_audit_finding_not_found:${findingId}`);
  const affected = affectedSets(candidate);
  return {
    kind: "agent_audit_finding_evidence",
    generatedAt: isoTimestamp(now),
    auditRunId: packet.runId,
    findingId,
    candidate,
    dbRows: filterRowsForAffected(packet.auditFacts.records, affected),
    pipelineSteps: filterPipelineSteps(packet.auditFacts.records.pipelineRuns, affected),
    llmArtifacts: collectLlmArtifacts(packet.auditFacts.records, affected, candidate),
    sourceBundle: collectSourceBundleEvidence(packet.auditFacts.records, affected),
    publicUrlSnapshot: filterPublicSnapshot(packet.publicSnapshot, affected),
    similaritySignals: collectSimilaritySignals(packet.publicSnapshot, candidate),
    usageRecords: filterUsageRecords(packet.usageSummary.records, affected, candidate),
  };
}

function buildEntityEvidencePack({ kind, entityType, entityId, packet, generatedAt, filter }) {
  const records = packet.auditFacts.records;
  const affected = affectedSets({
    affectedSourceIds: entityType === "source" ? [entityId] : [],
    affectedArticleIds: [],
    affectedDraftIds: [],
    affectedEventIds: entityType === "event" ? [entityId] : [],
  });
  const matchingRows = filterRowsForAffected(records, affected);
  const expandedAffected = expandAffectedFromRows(affected, matchingRows);
  return {
    kind,
    generatedAt,
    auditRunId: packet.runId,
    entityType,
    entityId,
    dbRows: {
      ...matchingRows,
      sourceChannels: records.sourceChannels.filter(filter),
      sourceRuns: records.sourceRuns.filter(filter),
      collectorFailures: records.collectorFailures.filter(filter),
      articleBundles: records.articleBundles.filter(filter),
      publicEvents: records.publicEvents.filter(filter),
      processingLedger: records.processingLedger.filter(filter),
      pipelineRuns: records.pipelineRuns.filter(filter),
      eventDrafts: records.eventDrafts.filter(filter),
      feedback: records.feedback.filter(filter),
    },
    pipelineSteps: filterPipelineSteps(records.pipelineRuns, expandedAffected),
    llmArtifacts: collectLlmArtifacts(records, expandedAffected, {}),
    sourceBundle: collectSourceBundleEvidence(records, expandedAffected),
    publicUrlSnapshot: filterPublicSnapshot(packet.publicSnapshot, expandedAffected),
    similaritySignals: [],
    usageRecords: filterUsageRecords(packet.usageSummary.records, expandedAffected, {}),
  };
}

async function writeEvidencePack({ evidence, outputDir }) {
  const dir = outputDir ?? path.join(".agent-runs", evidence.auditRunId, "evidence");
  await mkdir(dir, { recursive: true });
  const id = evidence.findingId ?? evidence.entityId;
  const evidencePath = path.join(dir, `${safePathSegment(id)}.json`);
  await writeJson(evidencePath, evidence);
  return {
    ...evidence,
    evidencePath,
  };
}

function findCandidate(candidates, id, matchCluster) {
  return candidates.find((candidate) => {
    return candidate.candidateId === id || (matchCluster && candidate.clusterId === id);
  });
}

function affectedSets(candidate) {
  return {
    sourceIds: new Set(candidate.affectedSourceIds ?? []),
    articleIds: new Set(candidate.affectedArticleIds ?? []),
    draftIds: new Set(candidate.affectedDraftIds ?? []),
    eventIds: new Set(candidate.affectedEventIds ?? []),
  };
}

function expandAffectedFromRows(affected, rowsByKind) {
  const expanded = {
    sourceIds: new Set(affected.sourceIds),
    articleIds: new Set(affected.articleIds),
    draftIds: new Set(affected.draftIds),
    eventIds: new Set(affected.eventIds),
  };
  for (const row of Object.values(rowsByKind).flat()) {
    if (row.sourceId) expanded.sourceIds.add(row.sourceId);
    if (row.articleBundleId) expanded.articleIds.add(row.articleBundleId);
    if (row.draftId) expanded.draftIds.add(row.draftId);
    if (row.eventId) expanded.eventIds.add(row.eventId);
    if (row.canonicalEventId) expanded.eventIds.add(row.canonicalEventId);
  }
  return expanded;
}

function filterRowsForAffected(records, affected) {
  return {
    sourceChannels: records.sourceChannels.filter((row) => rowMatchesAffected(row, affected)),
    sourceRuns: records.sourceRuns.filter((row) => rowMatchesAffected(row, affected)),
    collectorFailures: records.collectorFailures.filter((row) => rowMatchesAffected(row, affected)),
    articleBundles: records.articleBundles.filter((row) => rowMatchesAffected(row, affected)),
    processingLedger: records.processingLedger.filter((row) => rowMatchesAffected(row, affected)),
    pipelineRuns: records.pipelineRuns.filter((row) => rowMatchesAffected(row, affected)),
    eventDrafts: records.eventDrafts.filter((row) => rowMatchesAffected(row, affected)),
    publicEvents: records.publicEvents.filter((row) => rowMatchesAffected(row, affected)),
    feedback: records.feedback.filter((row) => rowMatchesAffected(row, affected)),
  };
}

function filterPipelineSteps(pipelineRuns, affected) {
  return pipelineRuns
    .filter((run) => rowMatchesAffected(run, affected))
    .flatMap((run) => {
      return (run.steps ?? []).map((step) => ({ ...step, runId: run.runId }));
    });
}

function collectLlmArtifacts(records, affected, candidate) {
  const artifactPaths = new Set(candidate.artifactPaths ?? []);
  for (const row of records.llmUsage) {
    if (rowMatchesAffected(row, affected)) {
      if (row.requestArtifactPath) artifactPaths.add(row.requestArtifactPath);
      if (row.responseArtifactPath) artifactPaths.add(row.responseArtifactPath);
    }
  }
  for (const run of records.pipelineRuns) {
    if (!rowMatchesAffected(run, affected)) continue;
    for (const artifact of run.artifacts ?? []) {
      if (/request|response|extract|editor|policy/i.test(`${artifact.kind} ${artifact.path}`)) {
        artifactPaths.add(artifact.path);
      }
    }
  }
  return [...artifactPaths].map((artifactPath) => ({ artifactPath }));
}

function collectSourceBundleEvidence(records, affected) {
  const artifacts = records.pipelineRuns
    .filter((run) => rowMatchesAffected(run, affected))
    .flatMap((run) => (run.artifacts ?? []).filter((artifact) => {
      return /bundle|capture|article/i.test(`${artifact.kind} ${artifact.path}`);
    }))
    .map((artifact) => ({
      artifactId: artifact.artifactId,
      artifactPath: artifact.path,
      bucket: artifact.bucket,
      kind: artifact.kind,
    }));
  const articleBundles = records.articleBundles
    .filter((bundle) => rowMatchesAffected(bundle, affected))
    .map((bundle) => ({
      articleBundleId: bundle.articleBundleId,
      sourceUrl: bundle.sourceUrl,
      canonicalUrl: bundle.canonicalUrl,
      storageBucket: bundle.storageBucket,
      storagePrefix: bundle.storagePrefix,
      imageCount: bundle.imageCount,
      linkCount: bundle.linkCount,
    }));
  return {
    articleBundles,
    artifacts,
  };
}

function filterPublicSnapshot(publicSnapshot, affected) {
  return {
    counts: publicSnapshot.counts,
    events: publicSnapshot.events.filter((event) => rowMatchesAffected(event, affected)),
  };
}

function collectSimilaritySignals(publicSnapshot, candidate) {
  if (candidate.candidateType !== "possible_duplicate_cluster") return [];
  const ids = new Set(candidate.affectedEventIds ?? []);
  const events = publicSnapshot.events.filter((event) => ids.has(event.eventId));
  return [{
    type: "duplicate_key",
    key: events[0] ? duplicateKey(events[0]) : undefined,
    events: events.map((event) => ({
      eventId: event.eventId,
      title: event.title,
      startsAt: event.startsAt,
      venueName: event.venueName,
      sourceUrl: event.sourceUrl,
    })),
  }];
}

function filterUsageRecords(records, affected, candidate) {
  const artifactPaths = new Set(candidate.artifactPaths ?? []);
  return records.filter((row) => rowMatchesAffected(row, affected) ||
    artifactPaths.has(row.requestArtifactPath) ||
    artifactPaths.has(row.responseArtifactPath));
}

function rowMatchesAffected(row, affected) {
  if (affected.sourceIds.has(row.sourceId)) return true;
  if (affected.articleIds.has(row.articleBundleId)) return true;
  if (affected.draftIds.has(row.draftId)) return true;
  if (affected.eventIds.has(row.eventId)) return true;
  if (affected.eventIds.has(row.canonicalEventId)) return true;
  return false;
}

function buildSourceHealth({
  sourceChannels,
  sourceRuns,
  collectorFailures,
  articleBundles,
  processingLedger,
  pipelineRuns,
}) {
  const rows = [
    ...sourceChannels.map((row) => ({
      sourceId: row.sourceId,
      sourceName: row.sourceName,
      state: row.status,
      createdAt: row.lastCheckedAt ?? row.createdAt,
      sourceUrl: row.sourceUrl,
      failureReason: row.lastFailureReason,
    })),
    ...sourceRuns.map((row) => ({
      sourceId: row.sourceId,
      state: row.status,
      createdAt: row.startedAt ?? row.createdAt,
      articleCount: row.articleCount,
      failureReason: row.failureReason,
    })),
    ...collectorFailures.map((row) => ({
      sourceId: row.sourceId,
      state: "failed",
      createdAt: row.createdAt,
      failureReason: row.reason,
    })),
    ...articleBundles.map((row) => ({
      sourceId: row.sourceId,
      state: "captured",
      createdAt: row.capturedAt,
      articleBundleId: row.articleBundleId,
      sourceUrl: row.sourceUrl,
    })),
    ...processingLedger.map((row) => ({
      sourceId: row.sourceId,
      state: row.state,
      createdAt: row.createdAt,
      articleBundleId: row.articleBundleId,
    })),
    ...pipelineRuns.map((row) => ({
      sourceId: row.sourceId,
      state: row.status,
      createdAt: row.startedAt,
      articleBundleId: row.articleBundleId,
    })),
  ].filter((row) => row.sourceId);
  return [...groupBy(rows, (row) => row.sourceId).entries()].map(([sourceId, sourceRows]) => ({
    sourceId,
    sourceName: sourceRows.find((row) => row.sourceName)?.sourceName,
    articleCount: unique(sourceRows.map((row) => row.articleBundleId).filter(Boolean)).length,
    failureCount: sourceRows.filter((row) => ["failed", "error"].includes(row.state)).length,
    latestAt: latestTimestamp(sourceRows.map((row) => row.createdAt)),
    latestFailureReason: latestFailureReason(sourceRows),
    states: countBy(sourceRows, "state"),
  }));
}

function buildPipelineFunnel(slices) {
  return {
    byDataClass: Object.fromEntries(slices.map((slice) => {
      const ledger = slice.processingLedger;
      const funnel = {
        ...emptyFunnel(),
        dataClass: slice.dataClass,
        totalLedgerCount: ledger.length,
        pipelineRunCount: slice.pipelineRuns.length,
        capturedCount: countRows(ledger, "state", "captured"),
        analysisStartedCount: countRows(ledger, "state", "analysis_started"),
        publishedCount: countRows(ledger, "state", "published"),
        needsReviewCount: countRows(ledger, "state", "needs_review"),
        needsInfoCount: countRows(ledger, "state", "needs_info"),
        excludedCount: countRows(ledger, "state", "excluded"),
        duplicateCount: countRows(ledger, "state", "duplicate"),
        failedCount: countRows(ledger, "state", "failed"),
      };
      return [slice.dataClass, funnel];
    })),
  };
}

function emptyFunnel() {
  return {
    totalLedgerCount: 0,
    pipelineRunCount: 0,
    capturedCount: 0,
    analysisStartedCount: 0,
    publishedCount: 0,
    needsReviewCount: 0,
    needsInfoCount: 0,
    excludedCount: 0,
    duplicateCount: 0,
    failedCount: 0,
  };
}

function buildReviewState(slices) {
  const drafts = slices.flatMap((slice) => slice.eventDrafts);
  return {
    totalDraftCount: drafts.length,
    byReviewState: countBy(drafts, "reviewState"),
    byProcessingState: countBy(drafts, "processingState"),
  };
}

function buildPublicVisibility({ processingLedger, publicEvents }) {
  const productionPublishedLedger = processingLedger.filter((row) => {
    return row.dataClass === "production" && row.state === "published";
  });
  const publicEventIds = new Set(publicEvents.map((event) => event.eventId));
  const gaps = productionPublishedLedger.filter((row) => {
    return row.canonicalEventId && !publicEventIds.has(row.canonicalEventId);
  });
  return {
    publishedLedgerCount: productionPublishedLedger.length,
    publicEventCount: publicEvents.filter((event) => event.dataClass === "production").length,
    publicRenderableEventCount: publicEvents.filter((event) => {
      return event.dataClass === "production" && event.status === "published" && isPublicRenderableAuditEvent(event);
    }).length,
    gapEventIds: unique(gaps.map((row) => row.canonicalEventId).filter(Boolean)),
  };
}

function renderAuditBrief({ context, auditFacts, publicSnapshot, usageSummary, candidateIndex }) {
  const production = auditFacts.pipelineFunnel.byDataClass.production ?? emptyFunnel();
  const lines = [
    `# Agent Audit ${context.runId}`,
    "",
    `Window: ${context.window.startsAt} to ${context.window.endsAt}`,
    "",
    "## Facts",
    "",
    `- Production ledger rows: ${production.totalLedgerCount}`,
    `- Production published rows: ${production.publishedCount}`,
    `- Production failed rows: ${production.failedCount}`,
    `- Public renderable events: ${publicSnapshot.counts.publicRenderableRows}`,
    `- LLM requests: ${usageSummary.totals.requestCount}`,
    `- LLM cost CNY: ${microCnyToCny(usageSummary.totals.costMicroCny).toFixed(4)}`,
    "",
    "## Candidate Index",
    "",
    ...candidateIndex.candidates.map((candidate) => {
      return `- ${candidate.candidateId} ${candidate.candidateType} severity=${candidate.severityHint}`;
    }),
    "",
    "These candidates are not final root causes. Use the drilldown commands before deciding a fix.",
  ];
  return `${lines.join("\n")}\n`;
}

function normalizeSourceChannel(row) {
  return removeUndefined({
    sourceId: clean(row.sourceId ?? row.source_id),
    dataClass: clean(row.dataClass ?? row.data_class) ?? "production",
    sourceProvider: clean(row.sourceProvider ?? row.source_provider),
    sourceName: clean(row.sourceName ?? row.source_name),
    sourceUrl: clean(row.sourceUrl ?? row.source_url),
    externalId: clean(row.externalId ?? row.external_id),
    status: clean(row.status),
    lastCheckedAt: optionalIsoTimestamp(row.lastCheckedAt ?? row.last_checked_at),
    lastSuccessAt: optionalIsoTimestamp(row.lastSuccessAt ?? row.last_success_at),
    lastFailureReason: clean(row.lastFailureReason ?? row.last_failure_reason),
    diagnostics: row.diagnostics ?? [],
    createdAt: optionalIsoTimestamp(row.createdAt ?? row.created_at),
  });
}

function normalizeSourceRun(row) {
  return removeUndefined({
    runId: clean(row.runId ?? row.run_id),
    dataClass: clean(row.dataClass ?? row.data_class) ?? "production",
    sourceId: clean(row.sourceId ?? row.source_id),
    seedUrl: clean(row.seedUrl ?? row.seed_url),
    status: clean(row.status),
    startedAt: optionalIsoTimestamp(row.startedAt ?? row.started_at),
    finishedAt: optionalIsoTimestamp(row.finishedAt ?? row.finished_at),
    checkedUrlCount: safeNumber(row.checkedUrlCount ?? row.checked_url_count),
    articleCount: safeNumber(row.articleCount ?? row.article_count),
    draftCount: safeNumber(row.draftCount ?? row.draft_count),
    failureCount: safeNumber(row.failureCount ?? row.failure_count),
    failureReason: clean(row.failureReason ?? row.failure_reason),
    diagnostics: row.diagnostics ?? [],
    createdAt: optionalIsoTimestamp(row.createdAt ?? row.created_at),
  });
}

function normalizeCollectorFailure(row) {
  return removeUndefined({
    failureId: clean(row.failureId ?? row.failure_id),
    dataClass: clean(row.dataClass ?? row.data_class) ?? "production",
    sourceId: clean(row.sourceId ?? row.source_id),
    articleUrl: clean(row.articleUrl ?? row.article_url),
    stage: clean(row.stage),
    reason: clean(row.reason),
    message: clean(row.message),
    retryable: Boolean(row.retryable),
    screenshotAssetId: clean(row.screenshotAssetId ?? row.screenshot_asset_id),
    diagnostics: row.diagnostics ?? [],
    createdAt: optionalIsoTimestamp(row.createdAt ?? row.created_at),
  });
}

function normalizeArticleBundle(row) {
  return removeUndefined({
    articleBundleId: clean(row.articleBundleId ?? row.article_bundle_id ?? row.bundleId ?? row.bundle_id),
    dataClass: clean(row.dataClass ?? row.data_class) ?? "production",
    bundleVersion: clean(row.bundleVersion ?? row.bundle_version),
    sourceProvider: clean(row.sourceProvider ?? row.source_provider),
    sourceId: clean(row.sourceId ?? row.source_id),
    sourceName: clean(row.sourceName ?? row.source_name),
    sourceUrl: clean(row.sourceUrl ?? row.source_url),
    canonicalUrl: clean(row.canonicalUrl ?? row.canonical_url),
    publishedAt: optionalIsoTimestamp(row.publishedAt ?? row.published_at),
    capturedAt: optionalIsoTimestamp(row.capturedAt ?? row.captured_at),
    contentHash: clean(row.contentHash ?? row.content_hash),
    storageBucket: clean(row.storageBucket ?? row.storage_bucket),
    storagePrefix: clean(row.storagePrefix ?? row.storage_prefix),
    imageCount: safeNumber(row.imageCount ?? row.image_count),
    linkCount: safeNumber(row.linkCount ?? row.link_count),
    diagnostics: row.diagnostics ?? [],
  });
}

function normalizeLedgerRow(row) {
  return removeUndefined({
    id: clean(row.id ?? row.ledgerId ?? row.ledger_id),
    ledgerId: clean(row.ledgerId ?? row.ledger_id ?? row.id),
    articleBundleId: clean(row.articleBundleId ?? row.article_bundle_id ?? row.bundleId ?? row.bundle_id),
    sourceId: clean(row.sourceId ?? row.source_id ?? row.metadata?.sourceId),
    sourceUrl: clean(row.sourceUrl ?? row.source_url),
    contentHash: clean(row.contentHash ?? row.content_hash),
    state: clean(row.state),
    decision: clean(row.decision),
    reason: clean(row.reason),
    confidence: optionalNumber(row.confidence),
    provider: clean(row.provider),
    model: clean(row.model),
    promptVersion: clean(row.promptVersion ?? row.prompt_version),
    schemaVersion: clean(row.schemaVersion ?? row.schema_version),
    usageId: clean(row.usageId ?? row.usage_id),
    draftId: clean(row.draftId ?? row.draft_id),
    canonicalEventId: clean(row.canonicalEventId ?? row.canonical_event_id),
    excludedArticleId: clean(row.excludedArticleId ?? row.excluded_article_id),
    dataClass: clean(row.dataClass ?? row.data_class) ?? "production",
    errorDetails: plainObject(row.errorDetails ?? row.error_details),
    metadata: plainObject(row.metadata),
    createdAt: isoTimestamp(row.createdAt ?? row.created_at ?? new Date()),
  });
}

function normalizePipelineRun(row) {
  return removeUndefined({
    runId: clean(row.runId ?? row.run_id),
    dataClass: clean(row.dataClass ?? row.data_class) ?? "production",
    sourceKind: clean(row.sourceKind ?? row.source_kind),
    sourceId: clean(row.sourceId ?? row.source_id),
    articleBundleId: clean(row.articleBundleId ?? row.article_bundle_id),
    caseId: clean(row.caseId ?? row.case_id),
    status: clean(row.status),
    decision: clean(row.decision),
    reason: clean(row.reason),
    startedAt: isoTimestamp(row.startedAt ?? row.started_at ?? new Date()),
    finishedAt: optionalIsoTimestamp(row.finishedAt ?? row.finished_at),
    metadata: plainObject(row.metadata),
    steps: (row.steps ?? []).map(normalizePipelineStep),
    artifacts: (row.artifacts ?? []).map(normalizePipelineArtifact),
    createdAt: isoTimestamp(row.createdAt ?? row.created_at ?? row.startedAt ?? row.started_at ?? new Date()),
  });
}

function normalizePipelineStep(row) {
  return removeUndefined({
    stepId: clean(row.stepId ?? row.step_id),
    runId: clean(row.runId ?? row.run_id),
    stepOrder: optionalNumber(row.stepOrder ?? row.step_order),
    nodeName: clean(row.nodeName ?? row.node_name),
    nodeVersion: clean(row.nodeVersion ?? row.node_version),
    status: clean(row.status),
    decision: clean(row.decision),
    reason: clean(row.reason),
    provider: clean(row.provider),
    model: clean(row.model),
    promptVersion: clean(row.promptVersion ?? row.prompt_version),
    schemaVersion: clean(row.schemaVersion ?? row.schema_version),
    usageId: clean(row.usageId ?? row.usage_id),
    inputArtifactIds: row.inputArtifactIds ?? row.input_artifact_ids ?? [],
    outputArtifactIds: row.outputArtifactIds ?? row.output_artifact_ids ?? [],
    validationIssues: row.validationIssues ?? row.validation_issues ?? [],
    errorDetails: plainObject(row.errorDetails ?? row.error_details),
    startedAt: optionalIsoTimestamp(row.startedAt ?? row.started_at),
    finishedAt: optionalIsoTimestamp(row.finishedAt ?? row.finished_at),
    latencyMs: optionalNumber(row.latencyMs ?? row.latency_ms),
    attempts: (row.attempts ?? []).map(normalizePipelineAttempt),
  });
}

function normalizePipelineArtifact(row) {
  return removeUndefined({
    artifactId: clean(row.artifactId ?? row.artifact_id),
    runId: clean(row.runId ?? row.run_id),
    stepId: clean(row.stepId ?? row.step_id),
    dataClass: clean(row.dataClass ?? row.data_class) ?? "production",
    path: clean(row.path),
    kind: clean(row.kind),
    hash: clean(row.hash),
    bucket: clean(row.bucket),
    metadata: plainObject(row.metadata),
    createdAt: optionalIsoTimestamp(row.createdAt ?? row.created_at),
  });
}

function normalizePipelineAttempt(row) {
  return removeUndefined({
    attemptId: clean(row.attemptId ?? row.attempt_id),
    runId: clean(row.runId ?? row.run_id),
    stepId: clean(row.stepId ?? row.step_id),
    attemptNumber: optionalNumber(row.attemptNumber ?? row.attempt_number),
    provider: clean(row.provider),
    model: clean(row.model),
    promptVersion: clean(row.promptVersion ?? row.prompt_version),
    schemaVersion: clean(row.schemaVersion ?? row.schema_version),
    usage: plainObject(row.usage),
    validatorIssues: row.validatorIssues ?? row.validator_issues ?? [],
    reason: clean(row.reason),
    startedAt: optionalIsoTimestamp(row.startedAt ?? row.started_at),
    finishedAt: optionalIsoTimestamp(row.finishedAt ?? row.finished_at),
    latencyMs: optionalNumber(row.latencyMs ?? row.latency_ms),
  });
}

function normalizeDraftRow(row) {
  return removeUndefined({
    draftId: clean(row.draftId ?? row.draft_id ?? row.id),
    articleBundleId: clean(row.articleBundleId ?? row.article_bundle_id ?? row.bundleId ?? row.bundle_id),
    articleUrl: clean(row.articleUrl ?? row.article_url),
    dataClass: clean(row.dataClass ?? row.data_class) ?? "production",
    title: clean(row.title),
    organizer: clean(row.organizer),
    startsAt: optionalIsoTimestamp(row.startsAt ?? row.starts_at),
    endsAt: optionalIsoTimestamp(row.endsAt ?? row.ends_at),
    venueName: clean(row.venueName ?? row.venue_name),
    venueAddress: clean(row.venueAddress ?? row.venue_address),
    city: clean(row.city),
    reservationStatus: clean(row.reservationStatus ?? row.reservation_status),
    registrationUrl: clean(row.registrationUrl ?? row.registration_url),
    posterImageUrl: clean(row.posterImageUrl ?? row.poster_image_url),
    registrationQrImageUrl: clean(row.registrationQrImageUrl ?? row.registration_qr_image_url),
    posterAssetId: clean(row.posterAssetId ?? row.poster_asset_id),
    registrationQrAssetId: clean(row.registrationQrAssetId ?? row.registration_qr_asset_id),
    hardBlockers: row.hardBlockers ?? row.hard_blockers ?? [],
    softBlockers: row.softBlockers ?? row.soft_blockers ?? [],
    editorDecision: clean(row.editorDecision ?? row.editor_decision),
    editorReason: clean(row.editorReason ?? row.editor_reason),
    exceptionReasonCodes: row.exceptionReasonCodes ?? row.exception_reason_codes ?? [],
    actionabilityStatus: clean(row.actionabilityStatus ?? row.actionability_status),
    editorVersion: clean(row.editorVersion ?? row.editor_version),
    triageDecision: clean(row.triageDecision ?? row.triage_decision),
    publicEligibility: clean(row.publicEligibility ?? row.public_eligibility),
    eventKind: clean(row.eventKind ?? row.event_kind),
    scheduleKind: clean(row.scheduleKind ?? row.schedule_kind),
    confidence: optionalNumber(row.confidence ?? row.triage_confidence),
    processingState: clean(row.processingState ?? row.processing_state),
    reviewState: clean(row.reviewState ?? row.review_state),
    canonicalEventId: clean(row.canonicalEventId ?? row.canonical_event_id),
    sourceId: clean(row.sourceId ?? row.source_id ?? row.metadata?.sourceId),
    createdAt: optionalIsoTimestamp(row.createdAt ?? row.created_at),
  });
}

function normalizePublicEventRow(row) {
  return removeUndefined({
    eventId: clean(row.eventId ?? row.event_id ?? row.id),
    dataClass: clean(row.dataClass ?? row.data_class) ?? "production",
    title: clean(row.title),
    organizer: clean(row.organizer),
    startsAt: optionalIsoTimestamp(row.startsAt ?? row.starts_at),
    endsAt: optionalIsoTimestamp(row.endsAt ?? row.ends_at),
    venueName: clean(row.venueName ?? row.venue_name),
    venueAddress: clean(row.venueAddress ?? row.venue_address),
    reservationStatus: clean(row.reservationStatus ?? row.reservation_status),
    registrationUrl: clean(row.registrationUrl ?? row.registration_url),
    sourceUrl: clean(row.sourceUrl ?? row.source_url),
    summary: clean(row.summary),
    scheduleKind: clean(row.scheduleKind ?? row.schedule_kind),
    posterImageUrl: clean(row.posterImageUrl ?? row.poster_image_url),
    registrationQrImageUrl: clean(row.registrationQrImageUrl ?? row.registration_qr_image_url),
    posterAssetId: clean(row.posterAssetId ?? row.poster_asset_id),
    registrationQrAssetId: clean(row.registrationQrAssetId ?? row.registration_qr_asset_id),
    status: clean(row.status),
    publicEligibility: clean(row.publicEligibility ?? row.public_eligibility),
    eventKind: clean(row.eventKind ?? row.event_kind),
    resolutionDecision: clean(row.resolutionDecision ?? row.resolution_decision),
    articleBundleId: clean(row.articleBundleId ?? row.article_bundle_id ?? row.bundleId ?? row.bundle_id),
    sourceId: clean(row.sourceId ?? row.source_id ?? row.metadata?.sourceId),
    publishedAt: optionalIsoTimestamp(row.publishedAt ?? row.published_at),
    createdAt: optionalIsoTimestamp(row.createdAt ?? row.created_at),
  });
}

function normalizeFeedbackRow(row) {
  return removeUndefined({
    feedbackId: clean(row.feedbackId ?? row.feedback_id ?? row.id),
    dataClass: clean(row.dataClass ?? row.data_class) ?? "production",
    feedbackType: clean(row.feedbackType ?? row.feedback_type),
    evalRunId: clean(row.evalRunId ?? row.eval_run_id),
    caseId: clean(row.caseId ?? row.case_id),
    pipelineRunId: clean(row.pipelineRunId ?? row.pipeline_run_id),
    articleBundleId: clean(row.articleBundleId ?? row.article_bundle_id),
    draftId: clean(row.draftId ?? row.draft_id),
    eventId: clean(row.eventId ?? row.event_id),
    fieldName: clean(row.fieldName ?? row.field_name),
    reason: clean(row.reason),
    createdBy: clean(row.createdBy ?? row.created_by),
    status: clean(row.status),
    metadata: plainObject(row.metadata),
    createdAt: isoTimestamp(row.createdAt ?? row.created_at ?? new Date()),
  });
}

function normalizeUsageRow(row) {
  return removeUndefined({
    usageId: clean(row.usageId ?? row.usage_id ?? row.id),
    recordedAt: isoTimestamp(row.recordedAt ?? row.recorded_at ?? new Date()),
    operation: clean(row.operation),
    provider: clean(row.provider),
    model: clean(row.model),
    status: clean(row.status),
    dataClass: clean(row.dataClass ?? row.data_class) ?? "production",
    pipelineRunId: clean(row.pipelineRunId ?? row.pipeline_run_id),
    pipelineStepId: clean(row.pipelineStepId ?? row.pipeline_step_id),
    sourceId: clean(row.sourceId ?? row.source_id),
    sourceUrl: clean(row.sourceUrl ?? row.source_url),
    promptVersion: clean(row.promptVersion ?? row.prompt_version),
    schemaVersion: clean(row.schemaVersion ?? row.schema_version),
    errorCode: clean(row.errorCode ?? row.error_code),
    requestArtifactPath: clean(row.requestArtifactPath ?? row.request_artifact_path),
    responseArtifactPath: clean(row.responseArtifactPath ?? row.response_artifact_path),
    inputTokens: safeNumber(row.inputTokens ?? row.input_tokens),
    outputTokens: safeNumber(row.outputTokens ?? row.output_tokens),
    totalTokens: safeNumber(row.totalTokens ?? row.total_tokens),
    costMicroCny: safeNumber(row.costMicroCny ?? row.cost_micro_cny),
    latencyMs: optionalNumber(row.latencyMs ?? row.latency_ms),
    articleBundleId: clean(row.articleBundleId ?? row.article_bundle_id),
    eventDraftId: clean(row.eventDraftId ?? row.event_draft_id),
    evaluationRunId: clean(row.evaluationRunId ?? row.evaluation_run_id),
    metadata: plainObject(row.metadata),
  });
}

function isPublicRenderableAuditEvent(event) {
  if (event.status !== "published") return false;
  if (event.publicEligibility === "not_public") return false;
  if (["news", "visit", "cancellation", "unsupported"].includes(event.eventKind)) return false;
  if (["not_public_activity", "insufficient_info"].includes(event.resolutionDecision)) return false;
  return true;
}

function duplicateKey(event) {
  return [
    normalizeTextKey(event.title),
    normalizeTextKey(event.venueName),
    (event.startsAt ?? "").slice(0, 10),
  ].join("|");
}

function normalizeTextKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "")
    .slice(0, 80);
}

function groupUsage(records, keyFn) {
  return [...groupBy(records, keyFn).entries()].map(([key, rows]) => ({
    key,
    ...sumUsage(rows),
  }));
}

function sumUsage(records) {
  return {
    requestCount: records.length,
    successCount: records.filter((row) => row.status === "succeeded").length,
    errorCount: records.filter((row) => row.status === "failed").length,
    inputTokens: sum(records, "inputTokens"),
    outputTokens: sum(records, "outputTokens"),
    totalTokens: sum(records, "totalTokens"),
    costMicroCny: sum(records, "costMicroCny"),
  };
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const key = row[field] ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function countRows(rows, field, value) {
  return rows.filter((row) => row[field] === value).length;
}

function sourceIdsForLedger(rows, dataClass) {
  return unique(rows.filter((row) => row.dataClass === dataClass).map((row) => row.sourceId).filter(Boolean));
}

function articleIdsForLedgerState(rows, dataClass, states) {
  const set = new Set(states);
  return unique(rows
    .filter((row) => row.dataClass === dataClass && set.has(row.state))
    .map((row) => row.articleBundleId)
    .filter(Boolean));
}

function eventIdsForLedgerState(rows, dataClass, states) {
  const set = new Set(states);
  return unique(rows
    .filter((row) => row.dataClass === dataClass && set.has(row.state))
    .map((row) => row.canonicalEventId)
    .filter(Boolean));
}

function artifactPathsForRuns(runs, { dataClass }) {
  return unique(runs
    .filter((run) => run.dataClass === dataClass)
    .flatMap((run) => (run.artifacts ?? []).map((artifact) => artifact.path))
    .filter(Boolean));
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ""))];
}

function latestTimestamp(values) {
  const timestamps = values
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) return undefined;
  return new Date(Math.max(...timestamps)).toISOString();
}

function latestFailureReason(rows) {
  const failures = rows
    .filter((row) => row.failureReason)
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
  return failures[0]?.failureReason;
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + safeNumber(row[field]), 0);
}

function microCnyToCny(value) {
  return safeNumber(value) / 1_000_000;
}

function normalizeDataClasses(dataClasses) {
  const values = Array.isArray(dataClasses) && dataClasses.length > 0
    ? dataClasses
    : defaultAgentAuditDataClasses;
  return unique(values.map(clean)).map((value) => {
    if (!defaultAgentAuditDataClasses.includes(value)) {
      throw new Error(`agent_audit_data_class_invalid:${value}`);
    }
    return value;
  });
}

function positiveInteger(value, errorName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(errorName);
  return number;
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function optionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function optionalIsoTimestamp(value) {
  if (!value) return undefined;
  return isoTimestamp(value);
}

function isoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("agent_audit_timestamp_invalid");
  return date.toISOString();
}

function timestampId(value) {
  return isoTimestamp(value).replace(/[^0-9]/g, "").slice(0, 14);
}

function shortHash(value) {
  let hash = 0;
  for (const char of String(value)) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function removeUndefined(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function safePathSegment(value) {
  return String(value ?? "evidence").replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
