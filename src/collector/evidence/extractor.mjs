import { createHash } from "node:crypto";

import {
  articleBundleToEvidenceAssets,
  validateCapturedArticleBundle,
} from "../../capture/article-bundle.mjs";

export const evidenceSetVersion = "evidence-set-v1";

export function extractEvidenceFromArticleBundle(bundle) {
  validateCapturedArticleBundle(bundle);
  const imageEvidenceAssets = articleBundleToEvidenceAssets(bundle);
  const evidenceByImageId = new Map(
    bundle.images.map((image, index) => [image.id, imageEvidenceAssets[index]]),
  );

  const posters = [];
  const qrCodes = [];
  const articleImages = [];
  const nonRegistrationImages = [];
  const assetRequests = [];

  for (const image of bundle.images) {
    const evidenceAsset = evidenceByImageId.get(image.id);
    const labels = imageLabels(image);
    const nonRegistrationReason = nonRegistrationQrReason(image, labels);
    if (isQrRole(image.role) && !nonRegistrationReason) {
      const registrationLikely = registrationLabels(labels) ||
        isRegistrationQrRole(image.role);
      qrCodes.push(
        imageEvidence({
          kind: "qr_code",
          image,
          evidenceAsset,
          evidenceRole: registrationLikely ? "registration" : "qr",
          registrationLikely,
        }),
      );
      if (evidenceAsset) {
        assetRequests.push(
          assetRequest({
            role: registrationLikely ? "registration_qr" : "article_image",
            image,
            evidenceAsset,
          }),
        );
      }
      continue;
    }

    if (image.role === "poster" || looksLikePoster(image, labels)) {
      posters.push(imageEvidence({ kind: "poster", image, evidenceAsset }));
      if (evidenceAsset) {
        assetRequests.push(assetRequest({ role: "poster", image, evidenceAsset }));
      }
      continue;
    }

    if (nonRegistrationReason) {
      nonRegistrationImages.push(
        imageEvidence({
          kind: "non_registration_image",
          image,
          evidenceAsset,
          reason: nonRegistrationReason,
        }),
      );
    }
    articleImages.push(
      imageEvidence({
        kind: "article_image",
        image,
        evidenceAsset,
        nonRegistrationReason: nonRegistrationReason ?? "article_image",
      }),
    );
    if (evidenceAsset) {
      assetRequests.push(assetRequest({ role: "article_image", image, evidenceAsset }));
    }
  }

  const registrationUrls = [];
  const articleLinks = [];
  for (const link of bundle.links) {
    const evidence = linkEvidence(bundle, link);
    if (linkRegistrationLikely(link)) registrationUrls.push(evidence);
    else articleLinks.push(evidence);
  }

  const miniProgramActions = bundle.miniPrograms.map((action) =>
    miniProgramEvidence(bundle, action),
  );

  return removeUndefined({
    version: evidenceSetVersion,
    captureId: bundle.captureId,
    articleUrl: bundle.sourceUrl,
    canonicalUrl: bundle.canonicalUrl,
    contentHash: bundle.contentHash,
    posters,
    qrCodes,
    registrationUrls,
    miniProgramActions,
    articleImages,
    nonRegistrationImages,
    articleLinks,
    evidenceAssets: imageEvidenceAssets,
    assetRequests,
    summary: {
      posterCount: posters.length,
      qrCodeCount: qrCodes.length,
      registrationUrlCount: registrationUrls.length,
      miniProgramActionCount: miniProgramActions.length,
      articleImageCount: articleImages.length,
      nonRegistrationImageCount: nonRegistrationImages.length,
      imageDominant: !String(bundle.text ?? "").trim() && bundle.images.length > 0,
    },
  });
}

function imageEvidence({
  kind,
  image,
  evidenceAsset,
  evidenceRole = evidenceAsset?.role,
  registrationLikely = false,
  reason,
  nonRegistrationReason,
}) {
  return removeUndefined({
    kind,
    sourceImageId: image.id,
    assetId: evidenceAsset?.assetId,
    evidenceRole,
    registrationLikely,
    reason,
    nonRegistrationReason,
    sourceUrl: image.sourceUrl,
    storagePath: image.storagePath ?? image.path,
    width: image.width,
    height: image.height,
    textContent: image.textContent ?? image.alt,
    confidence: image.confidence,
  });
}

function linkEvidence(bundle, link) {
  const registrationLikely = linkRegistrationLikely(link);
  return removeUndefined({
    kind: registrationLikely ? "registration_url" : "article_link",
    evidenceId: stableEvidenceId("link", [bundle.captureId, link.url]),
    url: link.url,
    text: link.text,
    role: link.role,
    source: link.source,
    registrationLikely,
  });
}

function miniProgramEvidence(bundle, action) {
  const registrationLikely = actionRegistrationLikely(action);
  return removeUndefined({
    kind: "mini_program_action",
    evidenceId: stableEvidenceId("mini-program", [
      bundle.captureId,
      action.appId,
      action.path,
      action.url,
      action.text,
    ]),
    appId: action.appId,
    path: action.path,
    url: action.url,
    text: action.text,
    actionType: registrationLikely ? "registration" : (action.actionType ?? "mini_program"),
    source: action.source,
    registrationLikely,
  });
}

function assetRequest({ role, image, evidenceAsset }) {
  return removeUndefined({
    assetId: evidenceAsset.assetId,
    role,
    mediaType: "image",
    sourceImageId: image.id,
    sourceUrl: image.sourceUrl,
    storagePath: image.storagePath ?? image.path,
    width: image.width,
    height: image.height,
    contentHash: evidenceAsset.contentHash,
  });
}

function imageLabels(image) {
  return [image.alt, image.textContent, image.caption, image.nearbyText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isQrRole(role) {
  return ["qr", "registration", "registration_qr"].includes(
    String(role ?? "").trim().toLowerCase(),
  );
}

function isRegistrationQrRole(role) {
  return ["registration", "registration_qr"].includes(
    String(role ?? "").trim().toLowerCase(),
  );
}

function registrationLabels(value) {
  return /报名|预约|扫码|二维码|registration|register|sign\s*up|reserve/.test(value);
}

function footerQrLabels(value) {
  return /关注|公众号|follow|official\s*account|footer|页脚/.test(value);
}

function shareQrLabels(value) {
  return /分享|转发|share|contact|联系|客服/.test(value);
}

function nonRegistrationQrReason(image, labels) {
  if (!isQrRole(image.role)) return undefined;
  if (footerQrLabels(labels)) return "follow_or_footer_qr";
  if (shareQrLabels(labels)) return "share_or_contact_qr";
  if (image.role === "qr" && labels && !registrationLabels(labels) && !qrCodeLabels(labels)) {
    return "qr_without_registration_label";
  }
  return undefined;
}

function qrCodeLabels(value) {
  return /qr\s*code|qrcode/i.test(value);
}

function looksLikePoster(image, labels) {
  if (/poster|海报|活动|event|展览|festival|讲座/.test(labels)) return true;
  return (
    image.width >= 480 &&
    image.height >= 480 &&
    image.height / Math.max(image.width, 1) >= 0.75
  );
}

function linkRegistrationLikely(link) {
  return (
    String(link.role ?? "").toLowerCase() === "registration" ||
    registrationLabels(`${link.text ?? ""} ${link.url ?? ""}`.toLowerCase())
  );
}

function actionRegistrationLikely(action) {
  return (
    String(action.actionType ?? "").toLowerCase() === "registration" ||
    registrationLabels(`${action.text ?? ""} ${action.path ?? ""} ${action.url ?? ""}`.toLowerCase())
  );
}

function stableEvidenceId(prefix, parts) {
  return `${prefix}-${hashText(parts.map((part) => String(part ?? "")).join("\u001f")).slice(0, 24)}`;
}

function hashText(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function removeUndefined(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}
