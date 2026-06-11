import { describe, expect, it, vi } from "vitest";

import {
  parseAgentConfigArgs,
  runAgentConfigCli,
} from "./agent-config.mjs";

describe("agent config CLI", () => {
  it("parses candidate creation without allowing direct active stage writes", () => {
    const args = parseAgentConfigArgs([
      "create-candidate",
      "--data-class",
      "production",
      "--operation",
      "full_extract",
      "--provider",
      "siliconflow",
      "--model",
      "Qwen/Qwen3.6-27B",
      "--prompt-version",
      "full-extract.candidate.v2",
      "--prompt-text",
      "Extract Beijing public events.",
      "--schema-version",
      "v5-extraction-result.v1",
      "--params-json",
      "{\"temperature\":0}",
      "--budget-policy-json",
      "{\"maxCostMicroCny\":5000}",
      "--created-reason",
      "Compare candidate.",
    ]);

    expect(args).toMatchObject({
      command: "create-candidate",
      dataClass: "production",
      operation: "full_extract",
      provider: "siliconflow",
      params: { temperature: 0 },
      budgetPolicy: { maxCostMicroCny: 5000 },
    });
    expect(args).not.toHaveProperty("stage", "active");
  });

  it("requires eval justification for activation commands", () => {
    expect(() =>
      parseAgentConfigArgs([
        "activate",
        "--operation",
        "full_extract",
        "--config-id",
        "pmc-1",
      ]),
    ).toThrow("agent_config_eval_run_id_required");

    expect(parseAgentConfigArgs([
      "activate",
      "--operation",
      "full_extract",
      "--config-id",
      "pmc-1",
      "--eval-run-id",
      "eval-1",
      "--activation-reason",
      "Candidate passed gates.",
    ])).toMatchObject({
      command: "activate",
      configId: "pmc-1",
      evalRunId: "eval-1",
    });
  });

  it("rejects invalid candidate JSON parameters and missing schema versions", () => {
    expect(() =>
      parseAgentConfigArgs([
        "create-candidate",
        "--operation",
        "full_extract",
        "--provider",
        "siliconflow",
        "--model",
        "Qwen/Qwen3.6-27B",
        "--prompt-version",
        "full-extract.candidate.v2",
        "--prompt-text",
        "Extract Beijing public events.",
        "--schema-version",
        "v5-extraction-result.v1",
        "--params-json",
        "[\"not\",\"object\"]",
        "--created-reason",
        "Compare candidate.",
      ]),
    ).toThrow("invalid_json_object_for_params_json");

    expect(() =>
      parseAgentConfigArgs([
        "create-candidate",
        "--operation",
        "full_extract",
        "--provider",
        "siliconflow",
        "--model",
        "Qwen/Qwen3.6-27B",
        "--prompt-version",
        "full-extract.candidate.v2",
        "--prompt-text",
        "Extract Beijing public events.",
        "--created-reason",
        "Compare candidate.",
      ]),
    ).toThrow("agent_config_schema_version_required");
  });

  it("creates candidates through the authenticated admin API", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          config: { configId: "pmc-created", stage: "candidate" },
        };
      },
    }));
    const consoleLike = { log: vi.fn() };

    await expect(runAgentConfigCli([
      "create-candidate",
      "--operation",
      "full_extract",
      "--provider",
      "siliconflow",
      "--model",
      "Qwen/Qwen3.6-27B",
      "--prompt-version",
      "full-extract.candidate.v2",
      "--prompt-text",
      "Extract Beijing public events.",
      "--schema-version",
      "v5-extraction-result.v1",
      "--created-reason",
      "Compare candidate.",
    ], consoleLike, {
      env: {
        APP_BASE_URL: "https://example.com/",
        ADMIN_ACCESS_TOKEN: "admin-secret",
      },
      fetchImpl,
    })).resolves.toMatchObject({
      ok: true,
      config: { stage: "candidate" },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.com/api/admin/prompt-model-configs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer admin-secret",
        }),
      }),
    );
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toMatchObject({
      dataClass: "production",
      operation: "full_extract",
      provider: "siliconflow",
      createdReason: "Compare candidate.",
    });
    expect(body).not.toHaveProperty("stage");
    expect(consoleLike.log).toHaveBeenCalled();
  });

  it("activates configs through a separate explicit admin API call", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          config: {
            configId: "pmc-1",
            stage: "active",
            activationEvalRunId: "eval-1",
          },
        };
      },
    }));

    await expect(runAgentConfigCli([
      "activate",
      "--operation",
      "full_extract",
      "--config-id",
      "pmc-1",
      "--eval-run-id",
      "eval-1",
      "--activation-reason",
      "Candidate passed gates.",
    ], { log: vi.fn() }, {
      env: {
        APP_BASE_URL: "https://example.com",
        ADMIN_ACCESS_TOKEN: "admin-secret",
      },
      fetchImpl,
    })).resolves.toMatchObject({
      ok: true,
      config: { stage: "active" },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.com/api/admin/prompt-model-configs/pmc-1/activate",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      dataClass: "production",
      operation: "full_extract",
      evalRunId: "eval-1",
      activationReason: "Candidate passed gates.",
    });
  });
});
