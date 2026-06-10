import { describe, expect, it } from "vitest";

import {
  checkPipelineContract,
  collectPipelineContractViolations,
} from "./contract-checker.mjs";

describe("pipeline contract checker", () => {
  it("validates analysis input node output with pipeline context", () => {
    expect(() =>
      checkPipelineContract({
        nodeName: "analysis_input",
        context: { dataClass: "eval", runId: "eval-contract-test" },
        payload: {
          images: [{
            imageId: "poster",
            metadata: { sourceUrl: "https://upstream.example/poster.jpg" },
            asset: { kind: "public_url", url: "https://cdn.example/poster.jpg" },
          }],
          requiredCapabilities: { vision: true },
        },
      })
    ).not.toThrow();
  });

  it("reports when analysis image assets are raw capture references", () => {
    const violations = collectPipelineContractViolations({
      nodeName: "analysis_input",
      context: { dataClass: "eval", runId: "eval-contract-test" },
      payload: {
        images: [{
          imageId: "poster",
          metadata: { sourceUrl: "https://upstream.example/poster.jpg" },
          asset: { kind: "public_url", url: "https://upstream.example/poster.jpg" },
        }],
        requiredCapabilities: { vision: true },
      },
    });

    expect(violations).toContainEqual(
      expect.objectContaining({
        reason: "analysis_input_image_asset_uses_capture_reference",
        imageId: "poster",
      }),
    );
  });

  it("reports missing consumable image assets when vision is required", () => {
    expect(() =>
      checkPipelineContract({
        nodeName: "analysis_input",
        context: { dataClass: "eval", runId: "eval-contract-test" },
        payload: {
          images: [{
            imageId: "poster",
            metadata: { sourceUrl: "https://upstream.example/poster.jpg" },
          }],
          requiredCapabilities: { vision: true },
        },
      })
    ).toThrow("analysis_input_vision_asset_required");
  });

  it("reports analysis inputs explicitly marked not live-vision eligible", () => {
    const violations = collectPipelineContractViolations({
      nodeName: "analysis_input",
      context: { dataClass: "eval", runId: "eval-contract-test" },
      payload: {
        images: [{
          imageId: "poster",
          metadata: { sourceUrl: "https://upstream.example/poster.jpg" },
          asset: { kind: "public_url", url: "https://cdn.example/poster.jpg" },
        }],
        requiredCapabilities: { vision: true },
        eligibility: {
          liveVisionEligible: false,
          reason: "No real fixture asset.",
        },
      },
    });

    expect(violations).toContainEqual(
      expect.objectContaining({
        reason: "analysis_input_live_vision_not_eligible",
      }),
    );
  });
});
