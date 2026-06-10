import { describe, expect, it } from "vitest";

import { resolveEvidenceAssetImageUrlsFromRows } from "./evidence-asset-image-urls";

describe("evidence asset image URL resolution", () => {
  it("keeps public stored image URLs and safe source URLs", () => {
    expect(
      resolveEvidenceAssetImageUrlsFromRows(
        {
          posterImageUrl: "https://blob.example.com/posters/activity.png",
          posterImageAlt: "Activity poster",
          posterImageSourceUrl: "https://mp.weixin.qq.com/source-poster",
          registrationQrImageUrl: "https://blob.example.com/qr/register.png",
          registrationQrImageAlt: "Registration QR",
        },
        [],
      ),
    ).toEqual({
      posterImageUrl: "https://blob.example.com/posters/activity.png",
      posterImageAlt: "Activity poster",
      posterImageSourceUrl: "https://mp.weixin.qq.com/source-poster",
      registrationQrImageUrl: "https://blob.example.com/qr/register.png",
      registrationQrImageAlt: "Registration QR",
    });
  });

  it("rejects source-site image URLs from direct payloads", () => {
    expect(
      resolveEvidenceAssetImageUrlsFromRows(
        {
          posterImageUrl: "https://mmbiz.qpic.cn/poster.png",
          posterImageAlt: "Source-site poster",
          posterImageSourceUrl: "https://mp.weixin.qq.com/source-poster",
          registrationQrImageUrl: "https://mp.weixin.qq.com/qr.png",
          registrationQrImageAlt: "Source-site QR",
        },
        [],
      ),
    ).toEqual({});
  });

  it("falls back to stored evidence rows when direct payload image URLs are unsafe", () => {
    expect(
      resolveEvidenceAssetImageUrlsFromRows(
        {
          posterAssetId: "asset-poster-1",
          registrationQrAssetId: "asset-qr-1",
          posterImageUrl: "https://mmbiz.qpic.cn/poster.png",
          registrationQrImageUrl: "https://mp.weixin.qq.com/qr.png",
        },
        [
          {
            asset_id: "asset-poster-1",
            role: "poster",
            storage_path: "production/articles/bundle-1/poster.png",
            public_url: "https://blob.example.com/posters/activity.png",
            source_url: "https://mmbiz.qpic.cn/source-poster.png",
            text_content: "Activity poster",
          },
          {
            asset_id: "asset-qr-1",
            role: "registration",
            storage_path: "production/articles/bundle-1/qr.png",
            public_url: "https://blob.example.com/qr/register.png",
            source_url: "https://mmbiz.qpic.cn/source-qr.png",
            text_content: "Registration QR",
          },
        ],
      ),
    ).toEqual({
      posterImageUrl: "https://blob.example.com/posters/activity.png",
      posterImageAlt: "Activity poster",
      posterImageSourceUrl: "https://mmbiz.qpic.cn/source-poster.png",
      registrationQrImageUrl: "https://blob.example.com/qr/register.png",
      registrationQrImageAlt: "Registration QR",
    });
  });
});
