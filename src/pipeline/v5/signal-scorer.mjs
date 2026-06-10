export const signalScoreVersion = "v5-signal-score.v1";

const positiveRules = Object.freeze([
  {
    type: "date",
    weight: 2,
    maxMatches: 6,
    regex: /\b20\d{2}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?|\b\d{1,2}月\d{1,2}日|周[一二三四五六日天]|星期[一二三四五六日天]|\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?\b/giu,
  },
  {
    type: "time",
    weight: 2,
    maxMatches: 6,
    regex: /\b\d{1,2}[:：]\d{2}(?:\s*[-–—]\s*\d{1,2}[:：]\d{2})?|\b(?:am|pm)\b|(?:上午|下午|晚上|晚间|中午|早上)\s*\d{1,2}(?:[:：]\d{2})?\s*点?/giu,
  },
  {
    type: "place",
    weight: 2,
    maxMatches: 6,
    regex: /(?:地点|地址|场地|Venue|Address|北京市|北京|Online\s*\/\s*Zoom|Zoom|文化中心|使馆|学院|中心)[^\n，。；;]{0,60}/giu,
  },
  {
    type: "registration",
    weight: 3,
    maxMatches: 6,
    regex: /(?:报名|预约|扫码|二维码|购票|RSVP|register|registration|reservation|reserve|sign\s*up|external_url|mini_program)[^\n，。；;]{0,80}/giu,
  },
  {
    type: "ticket",
    weight: 2,
    maxMatches: 5,
    regex: /(?:门票|早鸟票|免费|免费入场|限额|名额|入场|票务|ticket|free\s+entry|free|paid\s+tokens?|tokens?|capacity|quota)[^\n，。；;]{0,60}/giu,
  },
  {
    type: "activity",
    weight: 2,
    maxMatches: 6,
    regex: /(?:活动|讲座|放映|展览|工作坊|市集|沙龙|嘉年华|节|演出|演绎|朗读|音乐|诗歌|lecture|screening|exhibition|workshop|salon|festival|performance|seminar|open\s+day|talk)[^\n，。；;]{0,80}/giu,
  },
]);

const negativeRules = Object.freeze([
  {
    type: "news_or_statement",
    weight: 2,
    maxMatches: 4,
    regex: /(?:新闻|消息|通稿|news|press\s+release|generic_not_event|negative product judgment)[^\n，。；;]{0,80}/giu,
  },
  {
    type: "recap",
    weight: 3,
    maxMatches: 4,
    regex: /(?:活动回顾|精彩回顾|往期回顾|已举办|圆满结束|圆满落幕|成功举办|recap|completed\s+event|past\s+event)[^\n，。；;]{0,80}/giu,
  },
  {
    type: "official_visit_or_meeting",
    weight: 2,
    maxMatches: 4,
    regex: /(?:访问|到访|拜访|official\s+visit|visit)[^\n，。；;]{0,80}/giu,
  },
  {
    type: "official_visit_or_meeting",
    weight: 2,
    maxMatches: 4,
    regex: /(?:会见|会谈|会晤|meeting|met\s+with)[^\n，。；;]{0,80}/giu,
  },
  {
    type: "news_or_statement",
    weight: 2,
    maxMatches: 4,
    regex: /(?:声明|公告|严正|statement|declaration|policy\s+information)[^\n，。；;]{0,80}/giu,
  },
  {
    type: "out_of_beijing",
    weight: 3,
    maxMatches: 4,
    regex: /(?:广州|上海|深圳|苏州|杭州|南京|成都|重庆|天津|西安|Guangzhou|Shanghai|Shenzhen|Suzhou|Hangzhou|Nanjing|Chengdu|Chongqing|Tianjin|not_beijing)[^\n，。；;]{0,80}/giu,
  },
  {
    type: "restricted_audience",
    weight: 3,
    maxMatches: 4,
    regex: /(?:仅限|内部|特定人群|邀请制|会员专属|不对外|not_general_public|limited\s+audience|members?\s+only|exclusive\s+to|teachers?\s+only|community\s+members)[^\n，。；;]{0,80}/giu,
  },
  {
    type: "historical_info",
    weight: 2,
    maxMatches: 4,
    regex: /(?:历史介绍|人物介绍|历史信息|historical\s+informational|not\s+an\s+attendable\s+activity)[^\n，。；;]{0,80}/giu,
  },
]);

export function scoreContentSignals(content = {}) {
  if (!content || typeof content !== "object") {
    throw new Error("signal_scorer_content_required");
  }

  const analysisText = analysisTextFor(content);
  const positiveSignals = [
    ...signalsFromRules(positiveRules, analysisText, "signal"),
    ...signalsFromMiniPrograms(content.miniPrograms),
    ...signalsFromLinks(content.links),
  ];
  const negativeSignals = signalsFromRules(negativeRules, analysisText, "negative_signal");
  const signals = assignSignalIds(dedupeSignals(positiveSignals), "signal");
  const scoredNegativeSignals = assignSignalIds(dedupeSignals(negativeSignals), "negative_signal");
  const score = sumWeights(signals);
  const negativeScore = sumWeights(scoredNegativeSignals);
  const decision = decide({ signals, negativeSignals: scoredNegativeSignals, score, negativeScore });

  return {
    version: signalScoreVersion,
    score,
    negativeScore,
    decision,
    signals,
    negativeSignals: scoredNegativeSignals,
    reason: reasonFor({ signals, negativeSignals: scoredNegativeSignals }),
  };
}

export const scoreNormalizedContent = scoreContentSignals;

function analysisTextFor(content) {
  const body = String(content.markdown ?? "")
    .split("\n")
    .filter((line) => !/^(?:Source|Published at|Source URL):/i.test(line.trim()))
    .join("\n");
  return [content.title, body].map((part) => String(part ?? "").trim()).filter(Boolean).join("\n");
}

function signalsFromRules(rules, text, idPrefix) {
  const signals = [];
  for (const rule of rules) {
    let matchCount = 0;
    for (const match of text.matchAll(rule.regex)) {
      const signalText = clean(match[0]);
      if (!signalText) continue;
      signals.push({
        id: `${idPrefix}_pending`,
        type: rule.type,
        text: signalText,
        weight: rule.weight,
        startIndex: match.index,
      });
      matchCount += 1;
      if (matchCount >= rule.maxMatches) break;
    }
  }
  return signals;
}

function signalsFromMiniPrograms(miniPrograms) {
  if (!Array.isArray(miniPrograms) || miniPrograms.length === 0) return [];
  return miniPrograms.map((miniProgram) => ({
    id: "signal_pending",
    type: "mini_program",
    text: [
      miniProgram.text,
      miniProgram.actionType,
      miniProgram.appId,
      miniProgram.path,
      miniProgram.url,
    ].map(clean).filter(Boolean).join(" | "),
    weight: 2,
  }));
}

function signalsFromLinks(links) {
  if (!Array.isArray(links) || links.length === 0) return [];
  return links.map((link) => ({
    id: "signal_pending",
    type: "link",
    text: [link.text, link.role, link.url].map(clean).filter(Boolean).join(" | "),
    weight: link.role === "registration" ? 2 : 1,
  }));
}

function assignSignalIds(signals, prefix) {
  return signals.map((signal, index) => ({
    ...signal,
    id: `${prefix}_${String(index + 1).padStart(3, "0")}`,
  }));
}

function dedupeSignals(signals) {
  const seen = new Set();
  const deduped = [];
  for (const signal of signals) {
    const key = `${signal.type}:${signal.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(signal);
  }
  return deduped;
}

function decide({ signals, negativeSignals, score, negativeScore }) {
  const positiveTypes = new Set(signals.map((signal) => signal.type));
  const negativeTypes = new Set(negativeSignals.map((signal) => signal.type));
  const hasCoreEventShape = (
    positiveTypes.has("date") &&
    positiveTypes.has("time") &&
    positiveTypes.has("activity") &&
    (
      positiveTypes.has("place") ||
      positiveTypes.has("registration") ||
      positiveTypes.has("mini_program") ||
      positiveTypes.has("link")
    )
  );
  const hasStrongNegative = [
    "news",
    "news_or_statement",
    "recap",
    "visit",
    "meeting",
    "official_visit_or_meeting",
    "statement",
    "out_of_beijing",
    "restricted_audience",
    "historical_info",
  ].some((type) => negativeTypes.has(type));

  if (negativeScore >= 5 && negativeScore >= score - 2) return "likely_non_event";
  if (hasStrongNegative && score >= 5) return "needs_review";
  if (hasCoreEventShape && score >= 8 && negativeScore <= 3) return "likely_event";
  if (score >= 5 && score > negativeScore) return "possible";
  if (negativeScore >= 4) return "likely_non_event";
  return "needs_review";
}

function reasonFor({ signals, negativeSignals }) {
  const positiveTypes = uniqueTypes(signals);
  const negativeTypes = uniqueTypes(negativeSignals);
  return [
    `positive signals: ${positiveTypes.length ? positiveTypes.join(", ") : "none"}`,
    `negative signals: ${negativeTypes.length ? negativeTypes.join(", ") : "none"}`,
  ].join("; ");
}

function uniqueTypes(signals) {
  return [...new Set(signals.map((signal) => signal.type))];
}

function sumWeights(signals) {
  return signals.reduce((total, signal) => total + Number(signal.weight ?? 0), 0);
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}
