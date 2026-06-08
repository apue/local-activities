import { createHash } from "node:crypto";

import {
  classifyImageCandidate,
  extractImageCandidatesFromHtml,
} from "../collector/evidence/wechat-images.mjs";
import { createCapturedArticleBundle } from "./article-bundle.mjs";

const maxBundleTextLength = 40_000;

export function createWechat2RssArticleBundle({
  article,
  capturedAt = new Date().toISOString(),
}) {
  const text = cleanText(
    [article.title, article.summary, article.contentText]
      .filter(Boolean)
      .join("\n"),
  ).slice(0, maxBundleTextLength);
  const images = imagesFromHtml(article.contentHtml, article.url);
  const htmlLinks = linksFromHtml(article.contentHtml, article.url);
  const htmlMiniPrograms = miniProgramsFromHtml(article.contentHtml);
  return createCapturedArticleBundle({
    sourceId: article.sourceId,
    sourceName: article.sourceName,
    provider: "wechat2rss",
    sourceUrl: article.url,
    canonicalUrl: article.canonicalUrl ?? article.url,
    finalUrl: article.url,
    title: article.title,
    authorName: article.sourceName,
    publishedAt: article.publishedAt,
    capturedAt,
    languageHints: inferLanguageHints(text),
    captureMode: captureModeForBundle({ text, images }),
    text,
    html: article.contentHtml,
    images,
    links: [...htmlLinks, ...(article.links ?? [])],
    miniPrograms: [...htmlMiniPrograms, ...(article.miniPrograms ?? [])],
    captureWarnings: article.captureWarnings,
    diagnostics: [
      {
        key: "wechat2rss_raw_id",
        value: article.rawId,
      },
    ].filter((entry) => entry.value),
  });
}

export function createLocalFixtureArticleBundle({
  fixtureId,
  sourceUrl,
  canonicalUrl,
  finalUrl,
  title,
  authorName,
  publishedAt,
  capturedAt = new Date().toISOString(),
  text = "",
  html,
  images = [],
  links = [],
  miniPrograms = [],
  diagnostics = [],
  captureWarnings = [],
  languageHints,
}) {
  const normalizedText = cleanText(text).slice(0, maxBundleTextLength);
  return createCapturedArticleBundle({
    sourceId: fixtureId,
    sourceName: "local_fixture",
    provider: "local_fixture",
    sourceUrl,
    canonicalUrl,
    finalUrl: finalUrl ?? canonicalUrl ?? sourceUrl,
    title,
    authorName,
    publishedAt,
    capturedAt,
    languageHints: languageHints ?? inferLanguageHints(normalizedText),
    captureMode: captureModeForBundle({ text: normalizedText, images }),
    text: normalizedText,
    html,
    images,
    links,
    miniPrograms,
    diagnostics,
    captureWarnings,
  });
}

export function imagesFromHtml(html, articleUrl) {
  return extractImageCandidatesFromHtml(html, { articleUrl }).map(
    (candidate, index) => {
      const role = classifyImageCandidate(candidate);
      return removeUndefined({
        id: `image-${String(index + 1).padStart(3, "0")}`,
        assetId: imageAssetId({ articleUrl, role, imageUrl: candidate.url }),
        sourceUrl: candidate.url,
        role,
        width: candidate.width,
        height: candidate.height,
        contentHash: hashText(candidate.url),
        alt: candidate.alt,
        textContent: candidateText(candidate),
        extractedBy: "dom",
        confidence: role === "article_image" ? 0.55 : 0.8,
      });
    },
  );
}

export function linksFromHtml(html, articleUrl) {
  const value = String(html ?? "");
  const links = [];
  const linkPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of value.matchAll(linkPattern)) {
    const href = readAttribute(match[1], "href");
    if (!href) continue;
    const text = stripTags(match[2]);
    links.push(
      removeUndefined({
        url: href,
        text,
        role: registrationText(`${text} ${href}`) ? "registration" : "article_link",
        source: "html",
      }),
    );
  }
  return dedupeByKey(links, (link) => {
    try {
      return new URL(link.url, articleUrl).toString();
    } catch {
      return link.url;
    }
  });
}

export function miniProgramsFromHtml(html) {
  const value = String(html ?? "");
  const entries = [];
  const miniProgramPattern =
    /<(?:mp-miniprogram|weapp|[^>]*\b(?:data-miniprogram-appid|data-weapp-appid|data-appid|appid)=)[^>]*>(?:[\s\S]*?<\/(?:mp-miniprogram|weapp|[^>]+)>)?/gi;
  for (const match of value.matchAll(miniProgramPattern)) {
    const tag = match[0];
    const attrs = tag.match(/^<[^>]+/)?.[0] ?? tag;
    const appId =
      readAttribute(attrs, "data-miniprogram-appid") ??
      readAttribute(attrs, "data-weapp-appid") ??
      readAttribute(attrs, "data-appid") ??
      readAttribute(attrs, "appid");
    const path =
      readAttribute(attrs, "data-miniprogram-path") ??
      readAttribute(attrs, "data-weapp-path") ??
      readAttribute(attrs, "data-path") ??
      readAttribute(attrs, "path");
    const text = stripTags(tag);
    if (!appId && !path && !text) continue;
    entries.push(
      removeUndefined({
        appId,
        path,
        text,
        actionType: registrationText(`${text} ${path ?? ""}`)
          ? "registration"
          : "mini_program",
        source: "html",
      }),
    );
  }
  return dedupeByKey(entries, (entry) =>
    [entry.appId ?? "", entry.path ?? "", entry.text ?? ""].join("\u001f"),
  );
}

export function captureModeForBundle({ text, images }) {
  const roles = images.map((image) => image.role);
  const hasQr = roles.includes("qr") || roles.includes("registration");
  const hasPoster = roles.includes("poster");
  const hasText = Boolean(text?.trim());
  if (hasQr && hasPoster) return "image_with_qr_registration";
  if (hasQr) return "text_with_qr_registration";
  if (!hasText && hasPoster) return "image_dominant";
  return "text_complete";
}

function imageAssetId({ articleUrl, role, imageUrl }) {
  const assetHash = hashText(`${articleUrl}\n${role}\n${imageUrl}`);
  return `asset-${assetHash.slice(0, 24)}`;
}

function inferLanguageHints(text) {
  const hints = [];
  if (/[\u4e00-\u9fff]/.test(text)) hints.push("zh");
  if (/[áéíóúñü]|\b(el|la|los|las|de|para|con)\b/i.test(text)) {
    hints.push("es");
  }
  if (/[àâçéèêëîïôûùüÿœæ]|\b(le|la|les|des|pour|avec)\b/i.test(text)) {
    hints.push("fr");
  }
  if (/[a-z]/i.test(text)) hints.push("en");
  return hints.length ? [...new Set(hints)] : ["zh", "en"];
}

function cleanText(text) {
  return String(text ?? "")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readAttribute(tag, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = String(tag ?? "").match(pattern);
  return clean(match?.[2] ?? match?.[3] ?? match?.[4]);
}

function stripTags(value) {
  return decodeBasicHtmlEntities(String(value ?? "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeBasicHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function registrationText(value) {
  return /报名|预约|注册|register|sign\s*up|rsvp/i.test(String(value ?? ""));
}

function candidateText(candidate) {
  return clean(
    [candidate.alt, candidate.text, candidate.textContent, candidate.caption, candidate.nearbyText]
      .filter(Boolean)
      .join(" "),
  );
}

function dedupeByKey(values, keyFor) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyFor(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function hashText(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function removeUndefined(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}
