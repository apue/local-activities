import { createHash } from "node:crypto";

const defaultLookbackDays = 7;

export function readWechat2RssConfig(env) {
  const baseUrl = normalizeBaseUrl(env.WECHAT2RSS_BASE_URL ?? "");
  const token = env.WECHAT2RSS_TOKEN?.trim();
  const missing = [];
  if (!baseUrl) missing.push("WECHAT2RSS_BASE_URL");
  if (!token) missing.push("WECHAT2RSS_TOKEN");

  if (missing.length > 0) {
    return {
      ok: false,
      error: "missing_wechat2rss_config",
      missing,
    };
  }

  return {
    ok: true,
    baseUrl,
    token,
    lookbackDays: readPositiveInteger(
      env.WECHAT2RSS_LOOKBACK_DAYS,
      defaultLookbackDays,
    ),
  };
}

export function createWechat2RssClient({
  baseUrl,
  token,
  fetchImpl = fetch,
}) {
  return {
    async queryArticles({ after, content = false } = {}) {
      const url = new URL("/api/query", baseUrl);
      url.searchParams.set("k", token);
      if (after) url.searchParams.set("after", after);
      url.searchParams.set("content", content ? "1" : "0");

      return normalizeWechat2RssArticleQueryResponse(
        await fetchJson(url, fetchImpl),
      );
    },

    async listLogins() {
      const url = new URL("/login/list", baseUrl);
      url.searchParams.set("k", token);

      return normalizeWechat2RssLoginListResponse(
        await fetchJson(url, fetchImpl),
      );
    },
  };
}

export async function runWechat2RssSmoke({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
}) {
  const config = readWechat2RssConfig(env);
  if (!config.ok) {
    return {
      kind: "failed",
      healthStatus: "attention_needed",
      failureReason: "source_identity_missing",
      error: config.error,
      missing: config.missing,
    };
  }

  const client = createWechat2RssClient({
    baseUrl: config.baseUrl,
    token: config.token,
    fetchImpl,
  });
  const after = formatWechat2RssDate(
    new Date(now.getTime() - config.lookbackDays * 24 * 60 * 60 * 1000),
  );

  try {
    const [logins, articles] = await Promise.all([
      client.listLogins(),
      client.queryArticles({ after, content: false }),
    ]);
    const health = deriveWechat2RssHealth(logins);

    return {
      kind: health.failureReason ? "attention_needed" : "ok",
      healthStatus: health.healthStatus,
      failureReason: health.failureReason,
      baseUrl: config.baseUrl,
      after,
      accountCount: logins.accounts.length,
      articleCount: articles.articles.length,
      accounts: logins.accounts,
      sampleArticles: articles.articles.slice(0, 5),
    };
  } catch (error) {
    return {
      kind: "failed",
      healthStatus: "attention_needed",
      failureReason: mapWechat2RssErrorToFailureReason(error),
      error: error instanceof Error ? error.message : String(error),
      baseUrl: config.baseUrl,
      after,
    };
  }
}

export function normalizeWechat2RssArticleQueryResponse(input) {
  const items = readArray(input, ["data", "items", "list", "articles", "feeds"]);
  return {
    articles: items
      .map(normalizeWechat2RssArticle)
      .filter((article) => article.url),
  };
}

export function normalizeWechat2RssLoginListResponse(input) {
  const items = readArray(input, [
    "data",
    "items",
    "list",
    "accounts",
    "logins",
    "users",
  ]);
  return {
    accounts: items.map(normalizeWechat2RssAccount),
  };
}

export function deriveWechat2RssHealth(logins) {
  if (logins.accounts.length === 0) {
    return {
      healthStatus: "attention_needed",
      failureReason: "login_required",
    };
  }

  if (logins.accounts.some((account) => account.status === "healthy")) {
    return { healthStatus: "healthy" };
  }

  if (logins.accounts.some((account) => account.status === "account_risk")) {
    return {
      healthStatus: "attention_needed",
      failureReason: "fetch_blocked",
    };
  }

  return {
    healthStatus: "attention_needed",
    failureReason: "login_required",
  };
}

export function formatWechat2RssSmokeSummary(result) {
  const parts = [
    "Wechat2RSS smoke",
    `kind=${result.kind}`,
    `health=${result.healthStatus}`,
  ];
  if (result.failureReason) parts.push(`failure=${result.failureReason}`);
  if (result.accountCount != null) parts.push(`accounts=${result.accountCount}`);
  if (result.articleCount != null) parts.push(`articles=${result.articleCount}`);
  if (result.after) parts.push(`after=${result.after}`);
  if (result.missing?.length) parts.push(`missing=${result.missing.join(",")}`);
  return parts.join(" ");
}

function normalizeWechat2RssArticle(item) {
  const title = stringValue(item.title ?? item.name ?? item.articleTitle);
  const url = stringValue(item.url ?? item.link ?? item.articleUrl ?? item.mpUrl);
  const publishedAt = normalizePublishedAt(
    item.publishedAt ??
      item.pubDate ??
      item.date ??
      item.datetime ??
      item.time ??
      item.updateTime,
  );
  const sourceName = stringValue(
    item.sourceName ??
      item.accountName ??
      item.mpName ??
      item.author ??
      item.nickname,
  );
  const sourceId = stringValue(
    item.sourceId ?? item.accountId ?? item.mpId ?? item.biz ?? item.id,
  );
  const summary = stringValue(item.summary ?? item.digest ?? item.description);

  return removeUndefined({
    provider: "wechat2rss",
    url,
    title,
    publishedAt,
    sourceName,
    sourceId,
    summary,
    contentHash: hashJson({
      url,
      title,
      publishedAt,
      sourceName,
      sourceId,
      summary,
      content: stringValue(item.content),
    }),
    rawId: stringValue(item.id),
  });
}

function normalizeWechat2RssAccount(item) {
  const rawStatus = stringValue(
    item.status ?? item.state ?? item.loginStatus ?? item.message,
  ) ?? booleanAccountStatus(item);

  return removeUndefined({
    name: stringValue(
      item.name ?? item.nickname ?? item.username ?? item.accountName,
    ),
    accountId: stringValue(item.id ?? item.userId ?? item.wxid),
    rawStatus,
    status: normalizeAccountStatus(rawStatus),
  });
}

function normalizeAccountStatus(rawStatus) {
  const value = (rawStatus ?? "").toLowerCase();
  if (!value) return "unknown";
  if (
    value.includes("healthy") ||
    value.includes("normal") ||
    value.includes("available") ||
    value.includes("ok") ||
    value.includes("在线") ||
    value.includes("正常")
  ) {
    return "healthy";
  }
  if (
    value.includes("risk") ||
    value.includes("blocked") ||
    value.includes("black") ||
    value.includes("小黑屋") ||
    value.includes("风控")
  ) {
    return "account_risk";
  }
  if (
    value.includes("expired") ||
    value.includes("login") ||
    value.includes("offline") ||
    value.includes("unavailable") ||
    value.includes("失效") ||
    value.includes("登录")
  ) {
    return "login_required";
  }
  return "unknown";
}

function booleanAccountStatus(item) {
  if (item?.available === true && item?.needCheck !== true) return "available";
  if (item?.needCheck === true) return "login_required";
  if (item?.available === false) return "unavailable";
  return undefined;
}

async function fetchJson(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
    });
  } catch (error) {
    throw new Error(
      `wechat2rss_network_error:${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    throw new Error(`wechat2rss_http_error:${response.status}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error("wechat2rss_invalid_json");
  }
}

function mapWechat2RssErrorToFailureReason(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("401") || message.includes("403")) return "login_required";
  if (message.includes("429") || message.includes("blocked")) return "fetch_blocked";
  if (message.includes("network")) return "fetch_timeout";
  return "fetch_blocked";
}

function readArray(input, keys) {
  if (Array.isArray(input)) return input;
  for (const key of keys) {
    const value = input?.[key];
    if (Array.isArray(value)) return value;
  }
  for (const key of keys) {
    const value = input?.[key];
    if (value && typeof value === "object") {
      const nested = readArray(value, keys);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

function formatWechat2RssDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function normalizePublishedAt(value) {
  if (value == null || value === "") return undefined;
  if (typeof value === "number") {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(millis).toISOString();
  }
  const text = String(value).trim();
  if (/^\d{10}$/.test(text)) return new Date(Number(text) * 1000).toISOString();
  if (/^\d{13}$/.test(text)) return new Date(Number(text)).toISOString();
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function normalizeBaseUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function stringValue(value) {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function removeUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}
