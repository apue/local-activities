#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";

const forbiddenTextPatterns = [
  /Fixture case/i,
  /\b[a-z0-9-]+-fixture\b/i,
  /fixture-assets\//i,
  /https?:\/\/(?:www\.)?example\.com\b/i,
  /Organizer TBA/i,
];

const forbiddenImageHosts = [
  "mp.weixin.qq.com",
  "mmbiz.qpic.cn",
  "localhost",
  "127.0.0.1",
  "::1",
];

export function parsePublicCatalogSmokeArgs(argv) {
  const args = {
    envFiles: [],
    maxDetails: 10,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--env-file") {
      args.envFiles.push(readRequiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--max-details") {
      args.maxDetails = readPositiveIntegerArg(argv, index, arg, {
        min: 0,
        max: 50,
      });
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`unknown_arg:${arg}`);
    }
  }
  return args;
}

export async function runPublicCatalogSmoke({
  env = process.env,
  requestImpl,
  maxDetails = 10,
}) {
  const config = readPublicCatalogSmokeConfig(env);
  const request = requestImpl ?? requestHttp;
  const home = await request({
    name: "public_home",
    baseUrl: config.baseUrl,
    path: "/",
    method: "GET",
  });
  expectStatus(home, 200);
  scanPublicHtml({
    name: "public_home",
    path: "/",
    html: home.text,
  });

  const detailPaths = extractEventDetailPaths(home.text).slice(0, maxDetails);
  const checked = ["public_home"];
  for (const path of detailPaths) {
    const detail = await request({
      name: "public_detail",
      baseUrl: config.baseUrl,
      path,
      method: "GET",
    });
    expectStatus(detail, 200);
    scanPublicHtml({
      name: "public_detail",
      path,
      html: detail.text,
    });
    checked.push(`public_detail:${path}`);
  }

  return {
    kind: "passed",
    baseUrl: config.baseUrl,
    checked,
    detailCount: detailPaths.length,
  };
}

export function scanPublicHtml({ name, path, html }) {
  const text = String(html ?? "");
  for (const pattern of forbiddenTextPatterns) {
    if (pattern.test(text)) {
      throw new Error(
        `public_catalog_forbidden_text:${name}:${path}:${pattern.source}`,
      );
    }
  }

  for (const imageUrl of extractImageSrcs(text)) {
    assertPublicImageUrl({ name, path, imageUrl });
  }
}

export function extractEventDetailPaths(html) {
  const paths = new Set();
  for (const match of String(html ?? "").matchAll(/href=["']([^"']+)["']/g)) {
    const href = decodeHtmlEntities(match[1] ?? "");
    const path = toEventPath(href);
    if (path) paths.add(path);
  }
  return [...paths];
}

export function formatPublicCatalogSmokeSummary(result) {
  return [
    "Public catalog smoke passed",
    `baseUrl=${result.baseUrl}`,
    `details=${result.detailCount}`,
    `checked=${result.checked.join(",")}`,
  ].join(" ");
}

function assertPublicImageUrl({ name, path, imageUrl }) {
  if (imageUrl.startsWith("data:")) return;
  if (imageUrl.startsWith("/")) return;
  let url;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new Error(`public_catalog_invalid_image_url:${name}:${path}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`public_catalog_invalid_image_url:${name}:${path}`);
  }
  if (forbiddenImageHosts.some((host) => url.hostname.endsWith(host))) {
    throw new Error(`public_catalog_forbidden_image_host:${name}:${path}`);
  }
}

function extractImageSrcs(html) {
  return [...String(html ?? "").matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)]
    .map((match) => decodeHtmlEntities(match[1] ?? ""))
    .filter(Boolean);
}

function toEventPath(href) {
  try {
    const url = href.startsWith("http")
      ? new URL(href)
      : new URL(href, "https://local-activities.invalid");
    return /^\/events\/[^/?#]+$/.test(url.pathname) ? url.pathname : undefined;
  } catch {
    return undefined;
  }
}

function readPublicCatalogSmokeConfig(env) {
  const baseUrl = normalizeBaseUrl(
    env.APP_BASE_URL ?? env.NEXT_PUBLIC_APP_URL ?? "",
  );
  if (!baseUrl) throw new Error("missing_app_base_url");
  return { baseUrl };
}

async function requestHttp(request) {
  const response = await fetch(`${request.baseUrl}${request.path}`, {
    method: request.method,
  });
  return {
    status: response.status,
    text: await response.text(),
  };
}

function expectStatus(response, status) {
  if (response.status !== status) {
    throw new Error(`unexpected_status:${response.status}:expected_${status}`);
  }
}

function readRequiredValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing_value:${arg}`);
  return value;
}

function readPositiveIntegerArg(argv, index, arg, { min, max }) {
  const value = Number.parseInt(readRequiredValue(argv, index, arg), 10);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`invalid_${arg.replace(/^--/, "")}:${argv[index + 1]}`);
  }
  return value;
}

function normalizeBaseUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

function printUsage() {
  console.log(`Usage: pnpm smoke:public-catalog --env-file .env.local

Read-only checks:
- public homepage loads
- public event detail pages linked from the homepage load
- public pages do not expose fixture copy, placeholder asset paths, fake example.com URLs, or WeChat source-site image URLs

Options:
  --env-file <path>       Load env file. Repeatable.
  --max-details <number>  Max detail pages to inspect. Default: 10.
`);
}

async function main() {
  const args = parsePublicCatalogSmokeArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  const env = mergeEnvs(process.env, ...args.envFiles.map(loadEnvFile));
  const result = await runPublicCatalogSmoke({
    env,
    maxDetails: args.maxDetails,
  });
  console.log(formatPublicCatalogSmokeSummary(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
