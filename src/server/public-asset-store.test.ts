import { describe, expect, it } from "vitest";

import { putPublicEventImage } from "./public-asset-store";

describe("public asset store", () => {
  it("uploads public event images through an injected blob put implementation", async () => {
    const calls: unknown[] = [];

    await expect(
      putPublicEventImage(
        {
          bytes: Buffer.from("poster"),
          contentType: "image/png",
          keyHint: "Thai Festival Beijing 2026.png",
        },
        {
          put: async (...args: unknown[]) => {
            calls.push(args);
            return { url: "https://blob.example.com/event-posters/thai.png" };
          },
        },
      ),
    ).resolves.toEqual({
      url: "https://blob.example.com/event-posters/thai.png",
    });

    expect(calls).toEqual([
      [
        expect.stringMatching(/^event-posters\/thai-festival-beijing-2026-/),
        Buffer.from("poster"),
        expect.objectContaining({
          access: "public",
          contentType: "image/png",
          addRandomSuffix: true,
        }),
      ],
    ]);
  });
});
