const analysisInputVersion = "analysis-input-v1";

export function buildEvaluationAnalysisInput({ caseItem, bundle } = {}) {
  if (!bundle) throw new Error("analysis_input_bundle_required");
  const requiredCapabilities = {
    vision: requiresConsumableImageAsset(caseItem),
  };
  return {
    version: analysisInputVersion,
    article: {
      sourceUrl: caseItem?.case?.source?.url ?? bundle.sourceUrl,
      publishedAt: bundle.publishedAt,
      sourceProvider: bundle.provider ?? bundle.manifest?.sourceProvider,
      sourceName: bundle.sourceName ?? bundle.manifest?.sourceName,
      text: String(bundle.text ?? "").slice(0, 24000),
      htmlSummary: summarizeHtml(String(bundle.html ?? "")),
      links: bundle.links ?? [],
      diagnostics: bundle.diagnostics ?? [],
    },
    images: (bundle.images ?? []).map((image, index) => analysisInputImage(image, index)),
    requiredCapabilities,
    eligibility: {
      liveVisionEligible: caseItem?.case?.evaluation?.liveVisionEligible !== false,
      reason: caseItem?.case?.evaluation?.liveVisionReason,
    },
  };
}

export function analysisInputToLiveProviderParts(input) {
  const parts = [
    {
      type: "text",
      text: JSON.stringify({
        sourceUrl: input.article.sourceUrl,
        publishedAt: input.article.publishedAt,
        sourceProvider: input.article.sourceProvider,
        sourceName: input.article.sourceName,
        articleText: input.article.text,
        articleHtmlSummary: input.article.htmlSummary,
        links: input.article.links,
        diagnostics: input.article.diagnostics,
      }),
    },
  ];
  for (const image of input.images) {
    parts.push({ type: "image_metadata", image: image.metadata });
    if (image.asset?.url) {
      parts.push({
        type: "image_url",
        imageUrl: image.asset.url,
        imageId: image.imageId,
      });
    }
  }
  return parts;
}

export function requiresConsumableImageAsset(caseItem) {
  if (caseItem?.case?.evaluation?.liveVisionEligible === false) return true;
  const labels = new Set(caseItem?.case?.labels ?? []);
  const evidence = caseItem?.expected?.evidence ?? {};
  return (
    integer(evidence.posterCount) > 0 ||
    integer(evidence.qrCodeCount) > 0 ||
    labels.has("poster_or_image_dominant") ||
    labels.has("qr_registration") ||
    labels.has("qr_present_not_registration")
  );
}

function analysisInputImage(image, index) {
  const imageId = clean(image.imageId) ?? clean(image.id) ??
    `image-${String(index + 1).padStart(3, "0")}`;
  return {
    imageId,
    metadata: cleanObject({
      imageId,
      storagePath: clean(image.storagePath) ?? clean(image.path),
      sourceUrl: clean(image.sourceUrl),
      publicUrl: clean(image.publicUrl)?.startsWith("data:") ? undefined : clean(image.publicUrl),
      contentType: clean(image.contentType),
      contentHash: clean(image.contentHash),
      width: integer(image.width),
      height: integer(image.height),
      altText: clean(image.altText) ?? clean(image.alt),
      nearbyText: clean(image.nearbyText) ?? clean(image.textContent),
      roleHint: clean(image.roleHint) ?? clean(image.role),
    }),
    asset: consumableAsset(image),
  };
}

function consumableAsset(image) {
  const dataUrl = clean(image.dataUrl);
  if (dataUrl) {
    return { kind: "data_url", url: dataUrl };
  }
  const publicUrl = clean(image.publicUrl);
  if (publicUrl) {
    return { kind: publicUrl.startsWith("data:") ? "data_url" : "public_url", url: publicUrl };
  }
  return undefined;
}

function summarizeHtml(html) {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/\s+/g, " ")
    .slice(0, 12000);
}

function cleanObject(value) {
  if (Array.isArray(value)) return value.map(cleanObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, cleanObject(item)]),
  );
}

function integer(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}
