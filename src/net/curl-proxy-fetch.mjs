import { spawn } from "node:child_process";

const statusMarker = "\n__CURL_HTTP_STATUS__:";
const contentTypeMarker = "\n__CURL_CONTENT_TYPE__:";

export function createCurlProxyFetch(proxyUrl, { runCurlImpl = runCurl } = {}) {
  return async function curlProxyFetch(input, init = {}) {
    const request = input instanceof Request ? input : new Request(input, init);
    const body = request.method === "GET" || request.method === "HEAD"
      ? undefined
      : Buffer.from(await request.arrayBuffer());
    const args = [
      "--silent",
      "--show-error",
      "--location",
      "--http1.1",
      "--connect-timeout",
      "20",
      "--max-time",
      "180",
      "--retry",
      "3",
      "--retry-delay",
      "1",
      "--retry-all-errors",
      "--proxy",
      proxyUrl,
      "--request",
      request.method,
      "--write-out",
      `${statusMarker}%{http_code}${contentTypeMarker}%{content_type}`,
      request.url,
    ];
    for (const [name, value] of request.headers.entries()) {
      if (["content-length", "host"].includes(name.toLowerCase())) continue;
      args.push("--header", `${name}: ${value}`);
    }
    if (body?.length) args.push("--data-binary", "@-");

    const { stdout } = await runCurlImpl(args, body);
    const parsed = parseCurlOutput(stdout);
    const status = Number.parseInt(parsed.statusText.trim(), 10);
    if (!Number.isInteger(status)) {
      throw new Error(`curl_proxy_invalid_status:${parsed.statusText.trim()}`);
    }
    const headers = parsed.contentType
      ? { "content-type": parsed.contentType }
      : undefined;
    return new Response(parsed.body.length ? parsed.body : null, {
      status,
      headers,
    });
  };
}

function parseCurlOutput(stdout) {
  const output = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout));
  const statusMarkerBuffer = Buffer.from(statusMarker);
  const contentTypeMarkerBuffer = Buffer.from(contentTypeMarker);
  const statusIndex = output.lastIndexOf(statusMarkerBuffer);
  const contentTypeIndex = output.lastIndexOf(contentTypeMarkerBuffer);
  if (statusIndex < 0 || contentTypeIndex < statusIndex) {
    const markerIndex = output.lastIndexOf(Buffer.from("\n"));
    return {
      body: markerIndex >= 0 ? output.subarray(0, markerIndex) : Buffer.alloc(0),
      statusText: markerIndex >= 0
        ? output.subarray(markerIndex + 1).toString("utf8")
        : output.toString("utf8"),
      contentType: undefined,
    };
  }
  return {
    body: output.subarray(0, statusIndex),
    statusText: output
      .subarray(statusIndex + statusMarkerBuffer.length, contentTypeIndex)
      .toString("utf8"),
    contentType: output
      .subarray(contentTypeIndex + contentTypeMarkerBuffer.length)
      .toString("utf8")
      .trim() || undefined,
  };
}

function runCurl(args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdoutBuffer = Buffer.concat(stdout);
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        reject(new Error(`curl_proxy_failed:${code}:${stderrText}`));
      } else {
        resolve({ stdout: stdoutBuffer, stderr: stderrText });
      }
    });
    if (stdin?.length) child.stdin.end(stdin);
    else child.stdin.end();
  });
}
