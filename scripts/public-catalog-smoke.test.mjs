import { describe, expect, it } from "vitest";

import {
  extractEventDetailPaths,
  formatPublicCatalogSmokeSummary,
  parsePublicCatalogSmokeArgs,
  runPublicCatalogSmoke,
  scanPublicHtml,
} from "./public-catalog-smoke.mjs";

describe("public catalog smoke", () => {
  it("parses env file and detail limit args", () => {
    expect(
      parsePublicCatalogSmokeArgs([
        "--env-file",
        ".env.local",
        "--max-details",
        "3",
        "--proxy-url",
        "http://127.0.0.1:7897",
      ]),
    ).toEqual({
      envFiles: [".env.local"],
      maxDetails: 3,
      proxyUrl: "http://127.0.0.1:7897",
      help: false,
    });
  });

  it("checks public home and linked detail pages without admin credentials", async () => {
    const calls = [];
    const result = await runPublicCatalogSmoke({
      env: {
        APP_BASE_URL: "https://local-activities.example/",
      },
      requestImpl: async (request) => {
        calls.push({
          path: request.path,
          proxyUrl: request.proxyUrl,
        });
        if (request.path === "/") {
          return textResult(
            200,
            '<main><a href="/events/event-1">Real event</a></main>',
          );
        }
        if (request.path === "/events/event-1") {
          return textResult(
            200,
            '<main><img src="https://blob.example.com/poster.png" /><a href="https://mp.weixin.qq.com/s/source">Official source</a></main>',
          );
        }
        throw new Error(`unexpected_request:${request.path}`);
      },
    });

    expect(calls).toEqual([
      { path: "/", proxyUrl: undefined },
      { path: "/events/event-1", proxyUrl: undefined },
    ]);
    expect(result).toMatchObject({
      kind: "passed",
      detailCount: 1,
      checked: ["public_home", "public_detail:/events/event-1"],
    });
  });

  it("extracts event detail paths from relative and absolute links", () => {
    expect(
      extractEventDetailPaths(`
        <a href="/events/event-1">one</a>
        <a href="https://local-activities.example/events/event-2">two</a>
        <a href="/admin">admin</a>
      `),
    ).toEqual(["/events/event-1", "/events/event-2"]);
  });

  it("flags fixture copy, fake URLs, and WeChat source-site images", () => {
    expect(() =>
      scanPublicHtml({
        name: "detail",
        path: "/events/fixture",
        html: "Fixture case: https://example.com",
      }),
    ).toThrow("public_catalog_forbidden_text");

    expect(() =>
      scanPublicHtml({
        name: "detail",
        path: "/events/event-1",
        html: '<img src="https://mmbiz.qpic.cn/poster.png" />',
      }),
    ).toThrow("public_catalog_forbidden_image_host");
  });

  it("formats summaries without secret values", () => {
    const summary = formatPublicCatalogSmokeSummary({
      kind: "passed",
      baseUrl: "https://local-activities.example",
      detailCount: 0,
      checked: ["public_home"],
      proxyEnabled: true,
    });

    expect(summary).toContain("Public catalog smoke passed");
    expect(summary).toContain("details=0");
    expect(summary).toContain("proxy=enabled");
  });
});

function textResult(status, text) {
  return { status, text };
}
