import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

const legacyActiveCommands = [
  "regression:replay",
  "eval:run",
];

const activeDocs = [
  "docs/event-pipeline-architecture.md",
  "docs/event-pipeline-v5-phase1-goal.md",
  "docs/agent-operable-event-pipeline-goal.md",
  "docs/agent-operable-event-pipeline.zh.md",
  "docs/testing-strategy.md",
  "docs/tech-stack.md",
  "docs/regression-corpus.md",
  "docs/quickstart.md",
];

describe("active pipeline surface", () => {
  it("does not expose reset-era replay or eval scripts as active commands", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

    for (const command of legacyActiveCommands) {
      expect(packageJson.scripts, `${command} should not be an active package script`).not.toHaveProperty(command);
    }

    expect(packageJson.scripts).toHaveProperty("pipeline:v5:replay");
    expect(packageJson.scripts).toHaveProperty("pipeline:v5:eval");
    expect(packageJson.scripts).toHaveProperty("agent:regression-gate");
  });

  it("exposes the agent-operable regression gate as a deterministic package script", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

    expect(packageJson.scripts["agent:regression-gate"]).toBe(
      "node scripts/agent-operable-regression-gate.mjs",
    );
  });

  it("does not direct agents to run reset-era replay or eval commands in active docs", () => {
    const legacyCommandPattern = /pnpm\s+(regression:replay|eval:run)\b/;

    for (const relativePath of activeDocs) {
      const text = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
      expect(text, `${relativePath} references a legacy active command`).not.toMatch(legacyCommandPattern);
    }
  });
});
