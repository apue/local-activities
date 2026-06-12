import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const skillPath = ".agents/skills/local-activities-weekly-audit/SKILL.md";

describe("local activities weekly audit skill", () => {
  it("references audit workflow commands, repo docs, and permission boundaries", async () => {
    const text = await readFile(skillPath, "utf8");

    expect(text).toContain("name: local-activities-weekly-audit");
    expect(text).toContain("docs/agent-operable-event-pipeline-goal.md");
    expect(text).toContain("docs/agent-operable-event-pipeline.zh.md");
    expect(text).toContain("docs/event-pipeline-architecture.md");
    expect(text).toContain("pnpm agent:audit");
    expect(text).toContain("pnpm agent:inspect-finding");
    expect(text).toContain("pnpm agent:inspect-cluster");
    expect(text).toContain("pnpm agent:inspect-event");
    expect(text).toContain("pnpm agent:inspect-source");
    expect(text).toContain("pnpm agent:export-case");
    expect(text).toContain("Live Eval Review Loop");
    expect(text).toContain("pnpm agent:eval");
    expect(text).toContain("/admin/eval-runs/<eval-run-id>/preview");
    expect(text).toContain("eval_run_id");
    expect(text).toContain("case_id");
    expect(text).toContain("Requires explicit current approval");
    expect(text).toContain("destructive cleanup");
    expect(text).toContain("switching production active prompt/model config");
    expect(text).toContain("modifying secrets or environment variables");
    expect(text).toContain("treat audit candidates as final conclusions without drilldown evidence");
  });

  it("stays concise and delegates implementation details to repo contracts", async () => {
    const text = await readFile(skillPath, "utf8");

    expect(text.split(/\r?\n/).length).toBeLessThan(160);
    expect(text).not.toMatch(/create table\s+/i);
    expect(text).not.toMatch(/select\s+\*\s+from/i);
    expect(text).not.toContain("prompt text:");
  });
});
