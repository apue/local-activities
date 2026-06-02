import { describe, expect, it } from "vitest";

import { buildAssetStorageKey, contentHash, slugify } from "./storage-key";

describe("asset storage key helpers", () => {
  it("builds deterministic keys from role, slug, hash, and content type", () => {
    const hash = contentHash(Buffer.from("poster"));

    expect(
      buildAssetStorageKey({
        prefix: "event-posters",
        role: "poster",
        keyHint: "Thai Festival Beijing 2026.png",
        contentType: "image/png",
        contentHash: hash,
      }),
    ).toBe(`event-posters/poster/thai-festival-beijing-2026-${hash.slice(0, 16)}.png`);
  });

  it("normalizes unsafe slugs with a fallback", () => {
    expect(slugify("北京文化活动!!!", "poster")).toBe("poster");
  });
});
