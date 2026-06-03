import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildCandidateLookupFailureBlocker,
  parseRecordedResolutionResponse,
  resolutionPromptVersion,
  resolutionSchemaVersionV2,
  routeResolutionDecision,
} from "./event-resolution-v2-service";

describe("Event Pipeline V2 resolution service", () => {
  it("parses Beiping fixture as same_event against existing canonical event", () => {
    const result = parseRecordedResolutionResponse(
      readFixture("beiping-beer-festival", "resolution-response.json"),
    );

    expect(result).toMatchObject({
      promptVersion: resolutionPromptVersion,
      schemaVersion: resolutionSchemaVersionV2,
      decisions: [
        {
          eventDraftId: "draft-beiping-beer-festival",
          decision: "same_event",
          canonicalEventId: "event-beiping-beer-festival",
          confidence: 0.96,
        },
      ],
    });
    expect(routeResolutionDecision(result.decisions[0])).toEqual({
      reviewState: "possible_duplicate",
      normalReviewQueue: false,
      resolutionDecision: "same_event",
      canonicalEventId: "event-beiping-beer-festival",
    });
  });

  it("rejects malformed recorded resolution responses", () => {
    expect(() =>
      parseRecordedResolutionResponse({
        provider: "recorded",
        model: "fixture-model",
        decisions: [{ decision: "same_event", confidence: 2 }],
      }),
    ).toThrow("resolution_response_invalid");
  });

  it("keeps new events in ordinary review flow", () => {
    expect(
      routeResolutionDecision({
        eventDraftId: "draft-new",
        decision: "new_event",
        confidence: 0.91,
        rationale: "No candidate matched.",
      }),
    ).toEqual({
      reviewState: "ready_for_review",
      normalReviewQueue: true,
      resolutionDecision: "new_event",
    });
  });

  it("builds explainable blocker when candidate lookup fails", () => {
    expect(
      buildCandidateLookupFailureBlocker({
        reason: "event_candidate_lookup_failed",
      }),
    ).toEqual({
      code: "candidate_lookup_failed",
      message:
        "Candidate lookup failed; keep this draft in review and do not auto-publish.",
      sourceEvidence: {
        reason: "event_candidate_lookup_failed",
      },
    });
  });
});

function readFixture(caseId: string, fileName: string) {
  return JSON.parse(
    readFileSync(
      path.join(
        process.cwd(),
        "fixtures",
        "event-pipeline-v2",
        caseId,
        fileName,
      ),
      "utf8",
    ),
  );
}
