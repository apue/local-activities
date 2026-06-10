import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cleanCapturedArticleBundle } from "./content-cleaner.mjs";
import { scoreNormalizedContent } from "./signal-scorer.mjs";

describe("V5 signal scorer", () => {
  it("scores a public event with date, time, place, registration, activity, and mini program signals", async () => {
    const normalized = cleanCapturedArticleBundle(
      await readCorpusBundle("beiping-beer-festival-guide"),
    );

    const score = scoreNormalizedContent(normalized);

    expect(score.decision).toBe("likely_event");
    expect(signalTypes(score.signals)).toEqual(
      expect.arrayContaining([
        "date",
        "time",
        "place",
        "registration",
        "activity",
        "mini_program",
      ]),
    );
    expect(score.score).toBeGreaterThan(score.negativeScore);
    expect(score.reason).toContain("positive");
  });

  it("flags official meeting news as not likely event", async () => {
    const normalized = cleanCapturedArticleBundle(
      await readCorpusBundle("turkey-president-meeting-news"),
    );

    const score = scoreNormalizedContent(normalized);

    expect(score.decision).not.toBe("likely_event");
    expect(signalTypes(score.negativeSignals)).toEqual(
      expect.arrayContaining(["official_visit_or_meeting", "news_or_statement"]),
    );
    expect(score.negativeScore).toBeGreaterThan(0);
  });

  it("keeps sparse registration content as possible or likely event instead of excluding it", async () => {
    const normalized = cleanCapturedArticleBundle(
      await readCorpusBundle("korean-movie-two-screenings"),
    );

    const score = scoreNormalizedContent(normalized);

    expect(["likely_event", "possible"]).toContain(score.decision);
    expect(signalTypes(score.signals)).toEqual(
      expect.arrayContaining(["registration", "time", "activity"]),
    );
  });

  it("does not downgrade a complete public event only because the title contains historical review", async () => {
    const normalized = cleanCapturedArticleBundle(
      await readCorpusBundle("bac-equality-history-talk"),
    );

    const score = scoreNormalizedContent(normalized);

    expect(score.decision).toBe("likely_event");
    expect(score.score).toBeGreaterThan(score.negativeScore + 10);
  });
});

function signalTypes(signals) {
  return [...new Set(signals.map((signal) => signal.type))].sort();
}

async function readCorpusBundle(caseId) {
  const filePath = path.resolve("tests/regression-corpus", caseId, "captured-bundle.json");
  return JSON.parse(await readFile(filePath, "utf8"));
}
