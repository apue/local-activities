import { describe, expect, it } from "vitest";

import { createCurlProxyFetch } from "./curl-proxy-fetch.mjs";

describe("createCurlProxyFetch", () => {
  it("preserves response content type and binary body", async () => {
    const body = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x10]);
    const fetchImpl = createCurlProxyFetch("http://127.0.0.1:7897", {
      runCurlImpl: async () => ({
        stdout: Buffer.concat([
          body,
          Buffer.from(
            "\n__CURL_HTTP_STATUS__:200\n__CURL_CONTENT_TYPE__:image/jpeg",
          ),
        ]),
        stderr: "",
      }),
    });

    const response = await fetchImpl("https://mmbiz.qpic.cn/example.jpg");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
  });
});
