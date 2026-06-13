export const normalizedContentVersion = "v5-normalized-content.v1";

export function cleanArticleContent(bundle = {}) {
  if (!bundle || typeof bundle !== "object") {
    throw new Error("content_cleaner_bundle_required");
  }

  const markdown = normalizeMarkdown(
    clean(bundle.text) ?? textFromHtml(cleanRaw(bundle.html)) ?? "",
  );
  const links = normalizeLinks(bundle.links);
  const images = normalizeImages(bundle.images);
  const miniPrograms = normalizeMiniPrograms(bundle.miniPrograms);

  return {
    version: normalizedContentVersion,
    title: clean(bundle.title) ?? extractField(markdown, "Title"),
    sourceName: clean(bundle.sourceName) ?? extractField(markdown, "Source"),
    publishedAt: clean(bundle.publishedAt) ?? extractField(markdown, "Published at"),
    sourceUrl: clean(bundle.sourceUrl) ?? extractField(markdown, "Source URL"),
    markdown,
    links,
    images,
    miniPrograms,
    contentStats: {
      textLength: markdown.length,
      imageCount: images.length,
      linkCount: links.length,
      miniProgramCount: miniPrograms.length,
    },
  };
}

export const cleanCapturedArticleBundle = cleanArticleContent;

function textFromHtml(html) {
  if (!html) return undefined;
  const contentHtml = extractJsContent(html) ?? html;
  const text = decodeHtmlEntities(
    contentHtml
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
      .replace(/<(br|hr)\b[^>]*>/gi, "\n")
      .replace(/<\/(p|div|section|article|header|footer|h[1-6]|li|tr)>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, " "),
  );
  return clean(text);
}

function extractJsContent(html) {
  const source = String(html ?? "");
  const openMatch = /<([a-z0-9:-]+)\b[^>]*\bid=["']js_content["'][^>]*>/i.exec(source);
  if (!openMatch) return undefined;

  const tagName = openMatch[1];
  const bodyStart = openMatch.index + openMatch[0].length;
  const tagRegex = new RegExp(`<\\/?${escapeRegExp(tagName)}\\b[^>]*>`, "gi");
  tagRegex.lastIndex = bodyStart;

  let depth = 1;
  for (const tagMatch of source.matchAll(tagRegex)) {
    const tag = tagMatch[0];
    if (tag.startsWith("</")) {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart, tagMatch.index);
    } else if (!tag.endsWith("/>")) {
      depth += 1;
    }
  }

  return source.slice(bodyStart);
}

function normalizeMarkdown(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizeLinks(links) {
  if (!Array.isArray(links)) return [];
  return links
    .map((link) => {
      const url = clean(link?.url) ?? clean(link?.href);
      if (!url) return undefined;
      return cleanObject({
        url,
        text: clean(link.text) ?? clean(link.label),
        role: clean(link.role),
        source: clean(link.source),
      });
    })
    .filter(Boolean);
}

function normalizeImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .map((image, index) => {
      const id = clean(image?.id) ?? `image-${String(index + 1).padStart(3, "0")}`;
      return cleanObject({
        id,
        path: clean(image?.path),
        sourceUrl: clean(image?.sourceUrl),
        publicUrl: clean(image?.publicUrl),
        dataUrl: clean(image?.dataUrl),
        storagePath: clean(image?.storagePath),
        role: clean(image?.role),
        width: positiveInteger(image?.width),
        height: positiveInteger(image?.height),
        contentType: clean(image?.contentType),
        bytes: positiveInteger(image?.bytes),
        contentHash: clean(image?.contentHash),
        assetId: clean(image?.assetId),
        alt: clean(image?.alt) ?? clean(image?.altText),
        textContent: clean(image?.textContent) ?? clean(image?.nearbyText),
        extractedBy: clean(image?.extractedBy),
        confidence: boundedNumber(image?.confidence),
      });
    });
}

function normalizeMiniPrograms(miniPrograms) {
  if (!Array.isArray(miniPrograms)) return [];
  return miniPrograms
    .map((entry) => {
      const appId = clean(entry?.appId) ?? clean(entry?.appid);
      const path = clean(entry?.path);
      const url = clean(entry?.url);
      if (!appId && !path && !url) return undefined;
      return cleanObject({
        appId,
        path,
        url,
        text: clean(entry?.text) ?? clean(entry?.label),
        actionType: clean(entry?.actionType) ?? clean(entry?.role),
        source: clean(entry?.source),
      });
    })
    .filter(Boolean);
}

function extractField(text, fieldName) {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text ?? "").match(new RegExp(`^${escaped}:\\s*(.+)$`, "im"));
  return clean(match?.[1]);
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function cleanObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function boundedNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : undefined;
}

function clean(value) {
  const text = cleanRaw(value);
  return text ? text.trim() : undefined;
}

function cleanRaw(value) {
  if (value == null) return undefined;
  return String(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
