import type { SupabaseClient } from "@supabase/supabase-js";

type EvidenceAssetImageRow = {
  asset_id: string;
  role: string;
  storage_path: string | null;
  public_url: string | null;
  source_url: string | null;
  text_content: string | null;
};

export type EvidenceAssetImageInput = {
  dataClass?: "production" | "eval" | "test" | "smoke";
  posterAssetId?: string;
  registrationQrAssetId?: string;
  posterImageUrl?: string;
  posterImageAlt?: string;
  posterImageSourceUrl?: string;
  registrationQrImageUrl?: string;
  registrationQrImageAlt?: string;
};

export type EvidenceAssetImageUrls = {
  posterImageUrl?: string;
  posterImageAlt?: string;
  posterImageSourceUrl?: string;
  registrationQrImageUrl?: string;
  registrationQrImageAlt?: string;
};

export async function resolveEvidenceAssetImageUrls(
  client: SupabaseClient,
  input: EvidenceAssetImageInput,
): Promise<EvidenceAssetImageUrls> {
  const assetIds = uniqueStrings([
    input.posterImageUrl ? undefined : input.posterAssetId,
    input.registrationQrImageUrl ? undefined : input.registrationQrAssetId,
  ]);
  if (!assetIds.length) return existingImageUrls(input);

  const { data, error } = await client
    .from("evidence_assets")
    .select("asset_id,role,storage_path,public_url,source_url,text_content")
    .eq("data_class", input.dataClass ?? "production")
    .in("asset_id", assetIds);

  if (error) throw new Error("evidence_asset_lookup_failed");
  return resolveEvidenceAssetImageUrlsFromRows(
    input,
    (data ?? []) as EvidenceAssetImageRow[],
  );
}

export function resolveEvidenceAssetImageUrlsFromRows(
  input: EvidenceAssetImageInput,
  rows: EvidenceAssetImageRow[],
): EvidenceAssetImageUrls {
  const result = existingImageUrls(input);
  const posterRow = rows.find(
    (row) => row.asset_id === input.posterAssetId && row.role === "poster",
  );
  const posterUrl = publicEvidenceStorageUrl(posterRow?.public_url) ??
    publicEvidenceStorageUrl(posterRow?.storage_path);
  if (!result.posterImageUrl && posterUrl) {
    result.posterImageUrl = posterUrl;
    result.posterImageAlt = input.posterImageAlt ?? posterRow?.text_content ?? undefined;
    result.posterImageSourceUrl =
      input.posterImageSourceUrl ?? safeSourceUrl(posterRow?.source_url);
  }

  const qrRow = rows.find(
    (row) =>
      row.asset_id === input.registrationQrAssetId &&
      ["registration", "qr"].includes(row.role),
  );
  const qrUrl = publicEvidenceStorageUrl(qrRow?.storage_path);
  const resolvedQrUrl = publicEvidenceStorageUrl(qrRow?.public_url) ?? qrUrl;
  if (!result.registrationQrImageUrl && resolvedQrUrl) {
    result.registrationQrImageUrl = resolvedQrUrl;
    result.registrationQrImageAlt =
      input.registrationQrImageAlt ?? qrRow?.text_content ?? "Registration QR";
  }

  return result;
}

function existingImageUrls(input: EvidenceAssetImageInput): EvidenceAssetImageUrls {
  const posterImageUrl = publicEvidenceStorageUrl(input.posterImageUrl);
  const registrationQrImageUrl = publicEvidenceStorageUrl(
    input.registrationQrImageUrl,
  );
  return removeUndefined({
    posterImageUrl,
    posterImageAlt: posterImageUrl ? input.posterImageAlt : undefined,
    posterImageSourceUrl: posterImageUrl
      ? safeSourceUrl(input.posterImageSourceUrl)
      : undefined,
    registrationQrImageUrl,
    registrationQrImageAlt: registrationQrImageUrl
      ? input.registrationQrImageAlt
      : undefined,
  });
}

function publicEvidenceStorageUrl(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      return undefined;
    }
    if (
      url.hostname.endsWith("mmbiz.qpic.cn") ||
      url.hostname.endsWith("mp.weixin.qq.com")
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function safeSourceUrl(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function removeUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
