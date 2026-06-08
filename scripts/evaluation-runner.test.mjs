import { describe, expect, it } from "vitest";

import { parseArgs } from "./evaluation-runner.mjs";

describe("evaluation runner CLI", () => {
  it("parses pnpm separator arguments and repeated variants", () => {
    expect(
      parseArgs([
        "--",
        "--store",
        "memory",
        "--variant",
        "mock-expected-v1",
        "--variant",
        "mock-overfilter-v1",
        "--case",
        "korean-red-flavor",
        "--allow-live",
        "--max-cost-cny",
        "1.5",
      ]),
    ).toMatchObject({
      store: "memory",
      variantIds: ["mock-expected-v1", "mock-overfilter-v1"],
      caseIds: ["korean-red-flavor"],
      allowLive: true,
      maxCostCny: 1.5,
    });
  });

  it("rejects unknown stores", () => {
    expect(() => parseArgs(["--store", "production"]))
      .toThrow("evaluation_store_invalid:production");
  });
});
