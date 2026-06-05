import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260605030000_event_registration_qr_images.sql",
);

describe("event registration QR image migration", () => {
  it("adds public registration QR fields to event drafts and canonical events", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("alter table public.event_drafts");
    expect(migration).toContain("alter table public.canonical_events");
    for (const column of [
      "registration_qr_image_url text",
      "registration_qr_image_alt text",
    ]) {
      expect(migration).toContain(column);
    }
  });
});
