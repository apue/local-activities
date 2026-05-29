import { describe, expect, it } from "vitest";

import { selectRunner } from "./browser-runner-benchmark.mjs";

describe("browser runner benchmark", () => {
  it("selects the fastest successful runner", () => {
    expect(
      selectRunner([
        { runner: "playwright", ok: true, elapsedMs: 1400 },
        { runner: "agent_browser", ok: true, elapsedMs: 900 },
      ]),
    ).toBe("agent_browser");
  });

  it("ignores failed runners when selecting the default", () => {
    expect(
      selectRunner([
        { runner: "playwright", ok: false, elapsedMs: 200 },
        { runner: "agent_browser", ok: true, elapsedMs: 900 },
      ]),
    ).toBe("agent_browser");
  });
});
