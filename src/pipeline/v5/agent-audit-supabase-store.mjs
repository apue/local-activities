export function createSupabaseAgentAuditStore({ client, limit = 5_000 } = {}) {
  if (!client || typeof client.from !== "function") {
    throw new Error("agent_audit_supabase_client_required");
  }
  return {
    async listSourceChannels(input = {}) {
      return selectWindowedRows(client, {
        table: "source_channels",
        dataClass: input.dataClass,
        timestampColumn: "created_at",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        orderColumn: "created_at",
        limit,
      });
    },

    async listSourceRuns(input = {}) {
      return selectWindowedRows(client, {
        table: "source_runs",
        dataClass: input.dataClass,
        timestampColumn: "started_at",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        orderColumn: "started_at",
        limit,
      });
    },

    async listCollectorFailures(input = {}) {
      return selectWindowedRows(client, {
        table: "collector_failures",
        dataClass: input.dataClass,
        timestampColumn: "created_at",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        orderColumn: "created_at",
        limit,
      });
    },

    async listArticleBundles(input = {}) {
      return selectWindowedRows(client, {
        table: "article_bundles",
        dataClass: input.dataClass,
        timestampColumn: "captured_at",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        orderColumn: "captured_at",
        limit,
      });
    },

    async listProcessingLedger(input = {}) {
      return selectWindowedRows(client, {
        table: "processing_ledger",
        dataClass: input.dataClass,
        timestampColumn: "created_at",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        orderColumn: "created_at",
        limit,
      });
    },

    async listPipelineRuns(input = {}) {
      const runs = await selectWindowedRows(client, {
        table: "pipeline_runs",
        dataClass: input.dataClass,
        timestampColumn: "started_at",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        orderColumn: "started_at",
        limit,
      });
      const runIds = runs.map((run) => run.run_id).filter(Boolean);
      if (runIds.length === 0) return [];
      const [steps, artifacts, attempts] = await Promise.all([
        selectRunRows(client, {
          table: "pipeline_steps",
          dataClass: input.dataClass,
          runIds,
          orderColumn: "step_order",
          ascending: true,
          limit,
        }),
        selectRunRows(client, {
          table: "pipeline_artifacts",
          dataClass: input.dataClass,
          runIds,
          orderColumn: "created_at",
          ascending: true,
          limit,
        }),
        selectRunRows(client, {
          table: "pipeline_attempts",
          dataClass: input.dataClass,
          runIds,
          orderColumn: "attempt_number",
          ascending: true,
          limit,
        }),
      ]);
      const attemptsByStep = groupBy(attempts, (row) => row.step_id);
      const stepsByRun = groupBy(steps.map((step) => ({
        ...step,
        attempts: attemptsByStep.get(step.step_id) ?? [],
      })), (row) => row.run_id);
      const artifactsByRun = groupBy(artifacts, (row) => row.run_id);
      return runs.map((run) => ({
        ...run,
        steps: stepsByRun.get(run.run_id) ?? [],
        artifacts: artifactsByRun.get(run.run_id) ?? [],
      }));
    },

    async listEventDrafts(input = {}) {
      return selectWindowedRows(client, {
        table: "event_drafts",
        dataClass: input.dataClass,
        timestampColumn: "created_at",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        orderColumn: "created_at",
        limit,
      });
    },

    async listPublicEvents(input = {}) {
      return selectWindowedRows(client, {
        table: "canonical_events",
        dataClass: input.dataClass,
        timestampColumn: "created_at",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        orderColumn: "created_at",
        limit,
      });
    },

    async listFeedback(input = {}) {
      return selectWindowedRows(client, {
        table: "admin_feedback_ledger",
        dataClass: input.dataClass,
        timestampColumn: "created_at",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        orderColumn: "created_at",
        limit,
      });
    },

    async listLlmUsage(input = {}) {
      return selectWindowedRows(client, {
        table: "llm_usage_ledger",
        dataClass: input.dataClass,
        timestampColumn: "recorded_at",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        orderColumn: "recorded_at",
        limit,
      });
    },
  };
}

async function selectWindowedRows(client, {
  table,
  dataClass,
  timestampColumn,
  startsAt,
  endsAt,
  orderColumn,
  limit,
}) {
  let query = client
    .from(table)
    .select("*");
  if (dataClass) query = query.eq("data_class", dataClass);
  if (startsAt) query = query.gte(timestampColumn, startsAt);
  if (endsAt) query = query.lte(timestampColumn, endsAt);
  const { data, error } = await query
    .order(orderColumn, { ascending: false })
    .limit(limit);
  if (error) throw new Error(`agent_audit_supabase_select_failed:${table}`);
  return data ?? [];
}

async function selectRunRows(client, {
  table,
  dataClass,
  runIds,
  orderColumn,
  ascending,
  limit,
}) {
  let query = client
    .from(table)
    .select("*")
    .eq("data_class", dataClass)
    .in("run_id", runIds);
  const { data, error } = await query
    .order(orderColumn, { ascending })
    .limit(limit);
  if (error) throw new Error(`agent_audit_supabase_select_failed:${table}`);
  return data ?? [];
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}
