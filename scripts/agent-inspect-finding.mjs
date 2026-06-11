#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { inspectAgentFinding } from "../src/pipeline/v5/agent-audit.mjs";

export function parseAgentInspectFindingArgs(argv = []) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--finding-id") {
      args.findingId = requireValue(argv, ++index, arg);
    } else if (arg === "--audit-dir") {
      args.auditDir = requireValue(argv, ++index, arg);
    } else if (arg === "--output-dir") {
      args.outputDir = requireValue(argv, ++index, arg);
    } else {
      throw new Error(`unknown_agent_inspect_finding_arg:${arg}`);
    }
  }
  if (!args.findingId) throw new Error("agent_inspect_finding_id_required");
  if (!args.auditDir) throw new Error("agent_inspect_audit_dir_required");
  return args;
}

export async function runAgentInspectFindingCli(
  argv = process.argv.slice(2),
  consoleLike = console,
  { inspectImpl = inspectAgentFinding, now = new Date() } = {},
) {
  const args = parseAgentInspectFindingArgs(argv);
  const result = await inspectImpl({ ...args, now });
  consoleLike.log(JSON.stringify({
    ok: true,
    evidencePath: result.evidencePath,
    findingId: result.findingId,
    candidateType: result.candidate?.candidateType,
  }, null, 2));
  return result;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing_value_for_${flag.replace(/^--/, "").replaceAll("-", "_")}`);
  }
  return value;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAgentInspectFindingCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
