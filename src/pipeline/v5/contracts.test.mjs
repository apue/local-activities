import { describe, expect, it } from "vitest";

import {
  ALLOWED_V5_DATA_CLASSES,
  V5PipelineContractError,
  assertV5Contract,
  buildNodeResult,
  collectV5ContractViolations,
  createPipelineContext,
  validatePipelineContext,
} from "./contracts.mjs";

describe("V5 pipeline contracts", () => {
  it("creates and validates a pipeline context for allowed data classes", () => {
    expect(ALLOWED_V5_DATA_CLASSES).toEqual(["production", "eval", "test", "smoke"]);

    const context = createPipelineContext({
      dataClass: "eval",
      runId: "v5-run-1",
      articleId: "case-1",
    });

    expect(validatePipelineContext(context)).toMatchObject({
      dataClass: "eval",
      runId: "v5-run-1",
      articleId: "case-1",
    });
  });

  it("rejects an invalid pipeline data class", () => {
    expect(() =>
      createPipelineContext({
        dataClass: "draft",
        runId: "v5-run-1",
      })
    ).toThrow("v5_context_data_class_invalid");
  });

  it("rejects a missing pipeline run id", () => {
    expect(() =>
      validatePipelineContext({
        dataClass: "test",
      })
    ).toThrow("v5_context_run_id_required");
  });

  it("validates a complete V5 node result with artifact pointers", () => {
    const context = createPipelineContext({ dataClass: "test", runId: "v5-run-2" });
    const result = buildNodeResult({
      nodeName: "signal_scorer",
      nodeVersion: "v5-phase1",
      contractVersion: "v5-node-result.v1",
      context,
      startedAt: "2026-06-10T01:00:00.000Z",
      finishedAt: "2026-06-10T01:00:00.025Z",
      status: "completed",
      decision: "possible_event",
      reason: "date and registration signals found",
      externalCalls: [],
      validationIssues: [],
      inputArtifacts: [{
        artifactId: "artifact-input-1",
        path: "artifacts/v5-run-2/case-1/normalized-content.json",
        kind: "normalized_content",
        hash: "sha256:input",
      }],
      outputArtifacts: [{
        artifactId: "artifact-output-1",
        path: "artifacts/v5-run-2/case-1/signal-score.json",
        kind: "signal_score",
        hash: "sha256:output",
      }],
    });

    expect(assertV5Contract(result)).toBe(result);
    expect(result).toMatchObject({
      latencyMs: 25,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costMicroCny: 0,
        latencyMs: 25,
      },
      inputArtifacts: [expect.objectContaining({ artifactId: "artifact-input-1" })],
      outputArtifacts: [expect.objectContaining({ artifactId: "artifact-output-1" })],
    });
  });

  it("reports missing node result observability fields", () => {
    const violations = collectV5ContractViolations({
      nodeName: "cheap_triage",
      nodeVersion: "v5-phase1",
      context: { dataClass: "smoke", runId: "v5-smoke-1" },
      status: "completed",
      decision: "needs_review",
      reason: "candidate requires model triage",
      inputArtifacts: [],
      outputArtifacts: [],
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "v5_node_result_started_at_required" }),
        expect.objectContaining({ reason: "v5_node_result_finished_at_required" }),
        expect.objectContaining({ reason: "v5_node_result_contract_version_required" }),
        expect.objectContaining({ reason: "v5_node_result_external_calls_required" }),
        expect.objectContaining({ reason: "v5_node_result_usage_required" }),
        expect.objectContaining({ reason: "v5_node_result_validation_issues_required" }),
      ]),
    );
  });

  it("requires usable artifact pointers with kind, hash, and id or path", () => {
    const violations = collectV5ContractViolations({
      nodeName: "content_cleaner",
      nodeVersion: "v5-phase1",
      contractVersion: "v5-node-result.v1",
      context: { dataClass: "test", runId: "v5-run-artifact" },
      startedAt: "2026-06-10T01:00:00.000Z",
      finishedAt: "2026-06-10T01:00:00.005Z",
      status: "completed",
      decision: "normalized",
      reason: "cleaned bundle text",
      externalCalls: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costMicroCny: 0,
        latencyMs: 5,
      },
      validationIssues: [],
      inputArtifacts: [{}],
      outputArtifacts: [{ artifactId: "out", kind: "normalized_content" }],
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "v5_artifact_pointer_identity_required",
          fieldName: "inputArtifacts",
          index: 0,
        }),
        expect.objectContaining({
          reason: "v5_artifact_pointer_kind_required",
          fieldName: "inputArtifacts",
          index: 0,
        }),
        expect.objectContaining({
          reason: "v5_artifact_pointer_hash_required",
          fieldName: "inputArtifacts",
          index: 0,
        }),
        expect.objectContaining({
          reason: "v5_artifact_pointer_hash_required",
          fieldName: "outputArtifacts",
          index: 0,
        }),
      ]),
    );
  });

  it("does not hide explicitly invalid usage values during node result building", () => {
    const result = buildNodeResult({
      nodeName: "signal_scorer",
      nodeVersion: "v5-phase1",
      contractVersion: "v5-node-result.v1",
      context: { dataClass: "test", runId: "v5-invalid-usage" },
      startedAt: "2026-06-10T01:00:00.000Z",
      finishedAt: "2026-06-10T01:00:00.025Z",
      status: "completed",
      decision: "possible_event",
      reason: "usage should remain invalid",
      externalCalls: [],
      usage: {
        inputTokens: -1,
        outputTokens: 1.7,
        totalTokens: "3",
        costMicroCny: 0,
        latencyMs: 25,
      },
      validationIssues: [],
      inputArtifacts: [{
        artifactId: "artifact-input-1",
        path: "artifacts/v5-run-2/case-1/normalized-content.json",
        kind: "normalized_content",
        hash: "sha256:input",
      }],
      outputArtifacts: [{
        artifactId: "artifact-output-1",
        path: "artifacts/v5-run-2/case-1/signal-score.json",
        kind: "signal_score",
        hash: "sha256:output",
      }],
    });

    expect(result.usage.inputTokens).toBe(-1);
    expect(result.usage.outputTokens).toBe(1.7);
    expect(result.usage.totalTokens).toBe("3");
    expect(collectV5ContractViolations(result)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "v5_node_result_usage_input_tokens_invalid",
        }),
        expect.objectContaining({
          reason: "v5_node_result_usage_output_tokens_invalid",
        }),
        expect.objectContaining({
          reason: "v5_node_result_usage_total_tokens_invalid",
        }),
      ]),
    );
  });

  it("records attempt usage metadata with prompt and schema versions", () => {
    const context = createPipelineContext({ dataClass: "eval", runId: "v5-run-attempts" });
    const result = buildNodeResult({
      nodeName: "mock_full_extract",
      nodeVersion: "v5-phase1",
      contractVersion: "v5-node-result.v1",
      context,
      startedAt: "2026-06-10T02:00:00.000Z",
      finishedAt: "2026-06-10T02:00:01.500Z",
      status: "completed",
      decision: "event",
      reason: "mock expected output available",
      externalCalls: [],
      validationIssues: [],
      inputArtifacts: [],
      outputArtifacts: [],
      attempts: [{
        attempt: 1,
        provider: "mock",
        model: "mock-full-extract",
        promptVersion: "mock-full-extract.v1",
        schemaVersion: "full-extract.v1",
        usage: {
          inputTokens: 11,
          outputTokens: 7,
          costMicroCny: 0,
          latencyMs: 40,
        },
        startedAt: "2026-06-10T02:00:00.050Z",
        finishedAt: "2026-06-10T02:00:00.090Z",
        reason: "first deterministic mock attempt",
        validatorIssues: [],
      }],
    });

    expect(assertV5Contract(result)).toBe(result);
    expect(result.attempts).toEqual([
      expect.objectContaining({
        attempt: 1,
        provider: "mock",
        model: "mock-full-extract",
        promptVersion: "mock-full-extract.v1",
        schemaVersion: "full-extract.v1",
        usage: {
          inputTokens: 11,
          outputTokens: 7,
          totalTokens: 18,
          costMicroCny: 0,
          latencyMs: 40,
        },
        validatorIssues: [],
      }),
    ]);
  });

  it("throws a named V5 contract error with collected violations", () => {
    try {
      assertV5Contract({
        nodeName: "editor_pass",
        nodeVersion: "v5-phase1",
        contractVersion: "v5-node-result.v1",
        context: { dataClass: "test", runId: "v5-run-3" },
        startedAt: "2026-06-10T03:00:00.000Z",
        finishedAt: "2026-06-10T03:00:00.010Z",
        status: "completed",
        reason: "missing decision should fail",
        externalCalls: [],
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costMicroCny: 0,
          latencyMs: 10,
        },
        validationIssues: [],
        inputArtifacts: [],
        outputArtifacts: [],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(V5PipelineContractError);
      expect(error.name).toBe("V5PipelineContractError");
      expect(error.violations).toContainEqual(
        expect.objectContaining({ reason: "v5_node_result_decision_required" }),
      );
      return;
    }

    throw new Error("expected V5PipelineContractError");
  });
});
