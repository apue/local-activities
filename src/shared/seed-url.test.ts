import { describe, expect, it } from "vitest";

import { extractFirstHttpUrl } from "./seed-url";

describe("extractFirstHttpUrl", () => {
  it("returns plain URLs unchanged after trimming", () => {
    expect(extractFirstHttpUrl(" https://mp.weixin.qq.com/s/example ")).toBe(
      "https://mp.weixin.qq.com/s/example",
    );
  });

  it("extracts the first URL from shared text", () => {
    expect(
      extractFirstHttpUrl(
        "我发现一篇小红书，复制这段文字打开 App 查看 https://xhslink.com/a/abc123 ，还有更多内容",
      ),
    ).toBe("https://xhslink.com/a/abc123");
  });

  it("removes common trailing punctuation from shared URLs", () => {
    expect(extractFirstHttpUrl("活动链接：https://example.com/path?x=1。")).toBe(
      "https://example.com/path?x=1",
    );
  });

  it("returns null when text has no http URL", () => {
    expect(extractFirstHttpUrl("没有链接的分享文案")).toBeNull();
  });
});
