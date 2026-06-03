import { describe, expect, it } from "vitest";

import {
  putPublicEventAsset,
  putPublicEventImage,
} from "./public-asset-store";

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

  it("uploads QR evidence through the generic public asset boundary", async () => {
    const calls: unknown[] = [];

    await expect(
      putPublicEventAsset(
        {
          bytes: Buffer.from("qr"),
          contentType: "image/webp",
          keyHint: "Registration QR",
          role: "registration_qr",
        },
        {
          put: async (...args: unknown[]) => {
            calls.push(args);
            return {
              url: "https://blob.example.com/event-assets/registration_qr/qr.webp",
            };
          },
        },
      ),
    ).resolves.toEqual({
      url: "https://blob.example.com/event-assets/registration_qr/qr.webp",
    });

    expect(calls[0]).toEqual([
      expect.stringMatching(
        /^event-assets\/registration_qr\/registration-qr-/,
      ),
      Buffer.from("qr"),
      expect.objectContaining({
        access: "public",
        contentType: "image/webp",
        addRandomSuffix: true,
      }),
    ]);
  });
});
