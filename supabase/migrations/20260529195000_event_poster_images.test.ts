import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260529195000_event_poster_images.sql",
);

describe("event poster image migration", () => {
  it("adds public poster fields to event drafts and canonical events", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("alter table public.event_drafts");
    expect(migration).toContain("alter table public.canonical_events");
    for (const column of [
      "poster_image_url text",
      "poster_image_alt text",
      "poster_image_source_url text",
    ]) {
      expect(migration).toContain(column);
    }
  });
});
