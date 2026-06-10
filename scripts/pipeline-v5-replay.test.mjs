import { describe, expect, it } from "vitest";

import { runV5ReplayCli } from "./pipeline-v5-replay.mjs";

describe("pipeline-v5-replay CLI", () => {
  it("prints JSON summary for memory replay", async () => {
    let printed = "";
    const result = await runV5ReplayCli(
      ["--corpus-dir", "tests/regression-corpus", "--case", "beiping-beer-festival-guide", "--store", "memory"],
      {
        log: (value) => {
          printed += value;
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(JSON.parse(printed)).toMatchObject({
      ok: true,
      store: "memory",
      caseCount: 1,
    });
  });
});
