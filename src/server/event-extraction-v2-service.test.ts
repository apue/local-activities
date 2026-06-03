import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseRecordedTriageResponse } from "./editorial-triage-service";
import {
  extractionPromptVersion,
  extractionSchemaVersionV2,
  parseRecordedExtractionResponse,
  runRecordedExtractionFromTriage,
} from "./event-extraction-v2-service";

describe("Event Pipeline V2 extraction service", () => {
  it("rejects malformed recorded extraction responses", () => {
    expect(() =>
      parseRecordedExtractionResponse({
        provider: "recorded",
        model: "fixture-model",
        events: [{ title: "", confidence: 2 }],
      }),
    ).toThrow("extraction_response_invalid");
  });

  it("does not create ordinary extraction drafts for excluded triage decisions", () => {
    const result = runRecordedExtractionFromTriage({
      triage: parseRecordedTriageResponse(
        readFixture("official-visit-news", "triage-response.json"),
      ),
      extractionResponse: readFixture(
        "official-visit-news",
        "extraction-response.json",
      ),
    });

    expect(result).toEqual({
      route: "excluded",
      eventCandidates: [],
    });
  });

  it("extracts Sonic exhibition as a long-running schedule", () => {
    const result = extractCase("goethe-sonic-exhibition");

    expect(result.eventCandidates).toEqual([
      expect.objectContaining({
        title: "Sonic Other__lands 第三只耳——折叠的地景之间",
        publicEligibility: "public",
        eventKind: "long_running",
        scheduleKind: "long_running",
        endsAt: "2026-08-30T11:00:00.000Z",
        scheduleText:
          "即日起至2026年8月30日，周二至周日 10:00-18:00，周一闭馆",
      }),
    ]);
  });

  it("extracts weekly Goethe library recurrence and occurrences", () => {
    const result = extractCase("goethe-weekly-library");

    expect(result.eventCandidates[0]).toMatchObject({
      scheduleKind: "recurring",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=SA",
      occurrenceStartsAt: [
        "2026-06-06T08:00:00.000Z",
        "2026-06-13T08:00:00.000Z",
      ],
    });
  });

  it("separates Italian monthly activities and keeps weak mentions blocked", () => {
    const result = extractCase("italian-monthly-roundup");

    expect(result.eventCandidates).toHaveLength(4);
    expect(result.eventCandidates.at(-1)).toMatchObject({
      title: "Italian Date-only Mention",
      publicEligibility: "unclear",
      scheduleKind: "unsupported",
      hardBlockers: [
        { code: "unsupported_schedule", message: "Needs human review" },
      ],
    });
  });

  it("extracts Korean single-event fixture as high-confidence complete candidate", () => {
    const result = extractCase("korean-red-flavor");

    expect(result).toMatchObject({
      route: "extracted",
      promptVersion: extractionPromptVersion,
      schemaVersion: extractionSchemaVersionV2,
      eventCandidates: [
        expect.objectContaining({
          title: "Korean Culture Activity: Red Flavor",
          publicEligibility: "public",
          eventKind: "single",
          scheduleKind: "single",
          confidence: 0.96,
          hardBlockers: [],
          softBlockers: [],
        }),
      ],
    });
  });
});

function extractCase(caseId: string) {
  return runRecordedExtractionFromTriage({
    triage: parseRecordedTriageResponse(readFixture(caseId, "triage-response.json")),
    extractionResponse: readFixture(caseId, "extraction-response.json"),
  });
}

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
