import { describe, expect, it } from "vitest";

import { hydrateArticleBundleImages } from "./image-hydration.mjs";

describe("capture worker image hydration", () => {
  it("fetches the upstream image from Wechat2RSS local img-proxy URLs", async () => {
    const fetched = [];
    const result = await hydrateArticleBundleImages({
      bundle: {
        sourceUrl: "https://mp.weixin.qq.com/s/activity",
        images: [
          {
            id: "image-001",
            sourceUrl:
              "http://127.0.0.1:4000/img-proxy/?k=abc123&amp;u=https%3A%2F%2Fmmbiz.qpic.cn%2Fposter.jpg%3Fwx_fmt%3Djpeg%26from%3Dappmsg",
            role: "poster",
          },
        ],
      },
      fetchImpl: async (url) => {
        fetched.push(url);
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      },
    });

    expect(fetched).toEqual([
      "https://mmbiz.qpic.cn/poster.jpg?wx_fmt=jpeg&from=appmsg",
    ]);
    expect(result.images[0].bytes).toBeInstanceOf(Buffer);
    expect(result.images[0]).toMatchObject({
      sourceUrl: "https://mmbiz.qpic.cn/poster.jpg?wx_fmt=jpeg&from=appmsg",
      contentType: "image/jpeg",
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("keeps source references and records a warning when image fetch times out", async () => {
    const bundle = {
      sourceUrl: "https://mp.weixin.qq.com/s/activity",
      images: [
        {
          id: "image-001",
          sourceUrl: "https://mmbiz.qpic.cn/hangs.jpg",
          role: "poster",
        },
      ],
      captureWarnings: [],
    };

    let sawSignal = false;
    let sawAbort = false;
    const result = await hydrateArticleBundleImages({
      bundle,
      timeoutMs: 1,
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          if (!init?.signal) throw new Error("missing_abort_signal");
          sawSignal = true;
          init.signal.addEventListener("abort", () => {
            sawAbort = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    });

    expect(sawSignal).toBe(true);
    expect(sawAbort).toBe(true);
    expect(result.images[0]).toMatchObject({
      id: "image-001",
      sourceUrl: "https://mmbiz.qpic.cn/hangs.jpg",
    });
    expect(result.images[0].bytes).toBeUndefined();
    expect(result.captureWarnings[0]).toMatchObject({
      code: "image_fetch_failed",
      imageId: "image-001",
      severity: "warning",
    });
  });

  it("limits image fetch attempts even when downloads fail", async () => {
    const fetched = [];
    const result = await hydrateArticleBundleImages({
      bundle: {
        sourceUrl: "https://mp.weixin.qq.com/s/activity",
        images: [
          { id: "image-001", sourceUrl: "https://mmbiz.qpic.cn/1.jpg" },
          { id: "image-002", sourceUrl: "https://mmbiz.qpic.cn/2.jpg" },
          { id: "image-003", sourceUrl: "https://mmbiz.qpic.cn/3.jpg" },
        ],
      },
      maxImages: 2,
      fetchImpl: async (url) => {
        fetched.push(url);
        return new Response("", { status: 403 });
      },
    });

    expect(fetched).toEqual([
      "https://mmbiz.qpic.cn/1.jpg",
      "https://mmbiz.qpic.cn/2.jpg",
    ]);
    expect(result.images).toHaveLength(3);
    expect(result.captureWarnings).toHaveLength(2);
  });
});
