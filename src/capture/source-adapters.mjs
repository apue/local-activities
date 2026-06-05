import { createHash } from "node:crypto";

import {
  classifyImageCandidate,
  extractImageCandidatesFromHtml,
} from "../collector/evidence/wechat-images.mjs";
import { createCapturedArticleBundle } from "./article-bundle.mjs";

const maxBundleTextLength = 40_000;

export function createUrlBrowserArticleBundle({
  sourceId,
  sourceName,
  sourceUrl,
  finalUrl,
  title,
  authorName,
  publishedAt,
  capturedAt = new Date().toISOString(),
  text = "",
  html,
  languageHints,
}) {
  const normalizedText = cleanText(text).slice(0, maxBundleTextLength);
  const images = imagesFromHtml(html, sourceUrl);
  return createCapturedArticleBundle({
    sourceId,
    sourceName,
    provider: "url_browser",
    sourceUrl,
    finalUrl: finalUrl ?? sourceUrl,
    title,
    authorName,
    publishedAt,
    capturedAt,
    languageHints: languageHints ?? inferLanguageHints(normalizedText),
    captureMode: captureModeForBundle({ text: normalizedText, images }),
    text: normalizedText,
    html,
    images,
  });
}

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
  return createCapturedArticleBundle({
    sourceId: article.sourceId,
    sourceName: article.sourceName,
    provider: "wechat2rss",
    sourceUrl: article.url,
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
    diagnostics: [
      {
        key: "wechat2rss_raw_id",
        value: article.rawId,
      },
    ].filter((entry) => entry.value),
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
        extractedBy: "dom",
        confidence: role === "article_image" ? 0.55 : 0.8,
      });
    },
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

function hashText(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function removeUndefined(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}
