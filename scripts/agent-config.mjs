#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";

export function parseAgentConfigArgs(argv = []) {
  const command = argv[0];
  if (!command) throw new Error("agent_config_command_required");
  if (!["list", "active", "create-candidate", "activate"].includes(command)) {
    throw new Error(`unknown_agent_config_command:${command}`);
  }

  const args = {
    command,
    dataClass: "production",
    envFiles: [],
    params: {},
    budgetPolicy: {},
    metadata: {},
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-file") {
      args.envFiles.push(requireValue(argv, ++index, arg));
    } else if (arg === "--data-class") {
      args.dataClass = requireValue(argv, ++index, arg);
    } else if (arg === "--operation") {
      args.operation = requireValue(argv, ++index, arg);
    } else if (arg === "--stage") {
      args.stage = requireValue(argv, ++index, arg);
    } else if (arg === "--provider") {
      args.provider = requireValue(argv, ++index, arg);
    } else if (arg === "--model") {
      args.model = requireValue(argv, ++index, arg);
    } else if (arg === "--prompt-version") {
      args.promptVersion = requireValue(argv, ++index, arg);
    } else if (arg === "--prompt-text") {
      args.promptText = requireValue(argv, ++index, arg);
    } else if (arg === "--prompt-file") {
      args.promptText = readFileSync(requireValue(argv, ++index, arg), "utf8");
    } else if (arg === "--schema-version") {
      args.schemaVersion = requireValue(argv, ++index, arg);
    } else if (arg === "--params-json") {
      args.params = parseJsonObject(requireValue(argv, ++index, arg), arg);
    } else if (arg === "--budget-policy-json") {
      args.budgetPolicy = parseJsonObject(requireValue(argv, ++index, arg), arg);
    } else if (arg === "--metadata-json") {
      args.metadata = parseJsonObject(requireValue(argv, ++index, arg), arg);
    } else if (arg === "--created-reason") {
      args.createdReason = requireValue(argv, ++index, arg);
    } else if (arg === "--config-id") {
      args.configId = requireValue(argv, ++index, arg);
    } else if (arg === "--eval-run-id") {
      args.evalRunId = requireValue(argv, ++index, arg);
    } else if (arg === "--activation-reason") {
      args.activationReason = requireValue(argv, ++index, arg);
    } else {
      throw new Error(`unknown_agent_config_arg:${arg}`);
    }
  }

  if (command === "list") {
    return args;
  }
  if (!args.operation) throw new Error("agent_config_operation_required");
  if (command === "active") {
    return args;
  }
  if (command === "create-candidate") {
    for (const [field, errorName] of [
      ["provider", "provider"],
      ["model", "model"],
      ["promptVersion", "prompt_version"],
      ["promptText", "prompt_text"],
      ["schemaVersion", "schema_version"],
      ["createdReason", "created_reason"],
    ]) {
      if (!clean(args[field])) throw new Error(`agent_config_${errorName}_required`);
    }
    return args;
  }
  if (command === "activate") {
    for (const [field, errorName] of [
      ["configId", "config_id"],
      ["evalRunId", "eval_run_id"],
      ["activationReason", "activation_reason"],
    ]) {
      if (!clean(args[field])) throw new Error(`agent_config_${errorName}_required`);
    }
    return args;
  }
  return args;
}

export async function runAgentConfigCli(
  argv = process.argv.slice(2),
  consoleLike = console,
  {
    env = process.env,
    loadEnvFileImpl = loadEnvFile,
    fetchImpl = globalThis.fetch?.bind(globalThis),
  } = {},
) {
  const args = parseAgentConfigArgs(argv);
  const envFromFiles = args.envFiles.map((envFile) => loadEnvFileImpl(envFile));
  const mergedEnv = mergeEnvs(env, ...envFromFiles);
  const config = readAdminApiConfig(mergedEnv);
  const result = await requestAdminConfigApi({ args, config, fetchImpl });
  consoleLike.log(JSON.stringify(result, null, 2));
  return result;
}

export async function requestAdminConfigApi({ args, config, fetchImpl } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("agent_config_fetch_required");
  const headers = {
    authorization: `Bearer ${config.adminToken}`,
    "content-type": "application/json",
  };
  if (args.command === "list") {
    return requestJson(fetchImpl, {
      url: `${config.baseUrl}/api/admin/prompt-model-configs${queryString({
        data_class: args.dataClass,
        operation: args.operation,
        stage: args.stage,
      })}`,
      headers,
    });
  }
  if (args.command === "active") {
    return requestJson(fetchImpl, {
      url: `${config.baseUrl}/api/admin/prompt-model-configs/active${queryString({
        data_class: args.dataClass,
        operation: args.operation,
      })}`,
      headers,
    });
  }
  if (args.command === "create-candidate") {
    return requestJson(fetchImpl, {
      url: `${config.baseUrl}/api/admin/prompt-model-configs`,
      method: "POST",
      headers,
      body: {
        dataClass: args.dataClass,
        operation: args.operation,
        provider: args.provider,
        model: args.model,
        promptVersion: args.promptVersion,
        promptText: args.promptText,
        schemaVersion: args.schemaVersion,
        params: args.params,
        budgetPolicy: args.budgetPolicy,
        createdReason: args.createdReason,
        metadata: args.metadata,
      },
    });
  }
  if (args.command === "activate") {
    return requestJson(fetchImpl, {
      url: `${config.baseUrl}/api/admin/prompt-model-configs/${encodeURIComponent(args.configId)}/activate`,
      method: "POST",
      headers,
      body: {
        dataClass: args.dataClass,
        operation: args.operation,
        evalRunId: args.evalRunId,
        activationReason: args.activationReason,
      },
    });
  }
  throw new Error(`unknown_agent_config_command:${args.command}`);
}

function readAdminApiConfig(env) {
  const baseUrl = normalizeBaseUrl(
    env.APP_BASE_URL ?? env.NEXT_PUBLIC_APP_URL ?? "",
  );
  const adminToken = clean(env.ADMIN_ACCESS_TOKEN);
  if (!baseUrl) throw new Error("missing_app_base_url");
  if (!adminToken) throw new Error("missing_admin_access_token");
  return { baseUrl, adminToken };
}

async function requestJson(fetchImpl, { url, method = "GET", headers, body }) {
  const response = await fetchImpl(url, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = typeof response?.json === "function" ? await response.json() : undefined;
  if (!response?.ok) {
    const error = new Error(`agent_config_request_failed:${response?.status ?? "unknown"}`);
    error.response = json;
    throw error;
  }
  return json;
}

function queryString(input = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (clean(value)) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

function parseJsonObject(text, flag) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not_object");
    }
    return value;
  } catch {
    throw new Error(`invalid_json_object_for_${flag.replace(/^--/, "").replaceAll("-", "_")}`);
  }
}

function normalizeBaseUrl(value) {
  return clean(value)?.replace(/\/+$/g, "");
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing_value_for_${flag.replace(/^--/, "").replaceAll("-", "_")}`);
  }
  return value;
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAgentConfigCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
