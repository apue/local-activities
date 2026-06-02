import { describe, expect, it } from "vitest";

import { VercelBlobAssetStorage } from "./vercel-blob-storage";

describe("VercelBlobAssetStorage", () => {
  it("stores public assets and maps Vercel Blob metadata into app-owned asset records", async () => {
    const calls: unknown[] = [];
    const storage = new VercelBlobAssetStorage({
      prefix: "event-posters",
      put: async (...args) => {
        calls.push(args);
        return {
          url: "https://blob.example.com/event-posters/poster/thai.png",
          downloadUrl: "https://blob.example.com/event-posters/poster/thai.png?download=1",
          pathname: "event-posters/poster/thai.png",
          contentType: "image/png",
          etag: "etag-1",
        };
      },
    });

    const asset = await storage.put({
      bytes: Buffer.from("poster"),
      contentType: "image/png",
      keyHint: "Thai Festival Beijing 2026.png",
      role: "poster",
      access: "public",
    });

    expect(calls).toEqual([
      [
        expect.stringMatching(
          /^event-posters\/poster\/thai-festival-beijing-2026-[a-f0-9]{16}\.png$/,
        ),
        Buffer.from("poster"),
        {
          access: "public",
          contentType: "image/png",
          allowOverwrite: true,
        },
      ],
    ]);
    expect(asset).toMatchObject({
      assetId: "vercel_blob:event-posters/poster/thai.png",
      provider: "vercel_blob",
      key: "event-posters/poster/thai.png",
      access: "public",
      publicUrl: "https://blob.example.com/event-posters/poster/thai.png",
      downloadUrl: "https://blob.example.com/event-posters/poster/thai.png?download=1",
      contentType: "image/png",
      byteSize: Buffer.from("poster").byteLength,
      etag: "etag-1",
    });
    expect(asset.contentHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(storage.getPublicUrl(asset)).resolves.toBe(asset.publicUrl);
  });

  it("does not expose a public URL for private assets", async () => {
    const storage = new VercelBlobAssetStorage({
      put: async () => ({
        url: "https://blob.example.com/private/artifact.png",
        pathname: "runtime-assets/screenshot/artifact.png",
      }),
    });

    const asset = await storage.put({
      bytes: Buffer.from("private"),
      contentType: "image/png",
      keyHint: "private.png",
      role: "screenshot",
      access: "private",
    });

    expect(asset.publicUrl).toBeUndefined();
    await expect(storage.getPublicUrl(asset)).resolves.toBeNull();
  });
});
