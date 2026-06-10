export const candidatePacketVersion = "v5-candidate-packet.v1";

export function buildCandidatePacket({
  content,
  signals,
  normalized,
  signalScore,
  maxChars = 6000,
} = {}) {
  const packetContent = content ?? normalized;
  const packetSignals = signals ?? signalScore;
  if (!packetContent || typeof packetContent !== "object") {
    throw new Error("candidate_packet_content_required");
  }
  if (!packetSignals || typeof packetSignals !== "object") {
    throw new Error("candidate_packet_signals_required");
  }

  const sections = [];
  const sourceSignals = [...(packetSignals.signals ?? []), ...(packetSignals.negativeSignals ?? [])];

  addSection(sections, "metadata", "Metadata", [
    `Title: ${packetContent.title ?? ""}`,
    `Source: ${packetContent.sourceName ?? ""}`,
    `Published at: ${packetContent.publishedAt ?? ""}`,
    `Source URL: ${packetContent.sourceUrl ?? ""}`,
  ]);
  addSection(sections, "first_paragraphs", "First Paragraphs", [
    firstParagraph(packetContent.markdown),
  ]);
  addSection(sections, "signals", "Signals", [
    `Decision: ${packetSignals.decision ?? ""}`,
    `Score: ${packetSignals.score ?? 0}`,
    `Negative score: ${packetSignals.negativeScore ?? 0}`,
    `Positive: ${summarizeSignals(packetSignals.signals ?? [])}`,
    `Negative: ${summarizeSignals(packetSignals.negativeSignals ?? [])}`,
    `Reason: ${packetSignals.reason ?? ""}`,
  ]);

  if (Array.isArray(packetContent.links) && packetContent.links.length > 0) {
    addSection(sections, "links", "Links", packetContent.links.map(formatLink));
  }
  if (Array.isArray(packetContent.miniPrograms) && packetContent.miniPrograms.length > 0) {
    addSection(
      sections,
      "mini_programs",
      "Mini Programs",
      packetContent.miniPrograms.map(formatMiniProgram),
    );
  }
  if (Array.isArray(packetContent.images) && packetContent.images.length > 0) {
    addSection(sections, "images", "Images", packetContent.images.map(formatImage));
  }

  const signalWindows = buildSignalWindows(packetContent.markdown, sourceSignals);
  if (signalWindows.length > 0) {
    addSection(sections, "signal_windows", "Signal Windows", signalWindows);
  }

  addSection(sections, "tail", "Tail", [tailSnippet(packetContent.markdown)]);

  const { text: unlimitedPacketText, sectionRanges } = renderSectionsWithRanges(sections);
  const { text: packetText, truncated } = enforceMaxChars(unlimitedPacketText, maxChars);
  const retainedLength = retainedPrefixLength({ packetText, truncated });
  const includedSections = sections
    .filter((section) => sectionRanges.get(section.id)?.start < retainedLength)
    .map((section) => section.id);
  const droppedSections = sections
    .filter((section) => !includedSections.includes(section.id))
    .map((section) => section.id);
  if (truncated) includedSections.push("truncated");

  return {
    version: candidatePacketVersion,
    packetText,
    includedSections,
    droppedSections,
    sourceSignalIds: sourceSignals.map((signal) => signal.id).filter(Boolean),
    estimatedTokens: Math.ceil(packetText.length / 4),
  };
}

function addSection(sections, id, title, lines) {
  const body = lines.map((line) => String(line ?? "").trim()).filter(Boolean).join("\n");
  if (!body) return;
  sections.push({ id, title, body });
}

function renderSection(section) {
  return `${sectionMarker(section)}\n${section.body}`;
}

function renderSectionsWithRanges(sections) {
  let text = "";
  const sectionRanges = new Map();
  for (const section of sections) {
    if (text) text += "\n\n";
    const start = text.length;
    const rendered = renderSection(section);
    text += rendered;
    sectionRanges.set(section.id, { start, end: text.length });
  }
  return { text, sectionRanges };
}

function sectionMarker(section) {
  return `## ${section.title}`;
}

function firstParagraph(markdown) {
  const lines = String(markdown ?? "")
    .split(/\n{1,}/)
    .map((line) => line.trim())
    .filter(Boolean);
  return truncateText(lines.slice(0, 4).join("\n"), 900);
}

function tailSnippet(markdown) {
  return truncateFromEnd(String(markdown ?? "").trim(), 900);
}

function summarizeSignals(items) {
  if (!Array.isArray(items) || items.length === 0) return "none";
  return items
    .slice(0, 14)
    .map((signal) => `${signal.id}:${signal.type}:${signal.text}`)
    .join(" | ");
}

function buildSignalWindows(markdown, signals) {
  const text = String(markdown ?? "");
  const windows = [];
  const seen = new Set();
  for (const signal of signals.slice(0, 18)) {
    const index = resolveSignalIndex(text, signal);
    if (index < 0) continue;
    const start = Math.max(0, index - 140);
    const end = Math.min(text.length, index + String(signal.text ?? "").length + 180);
    const snippet = normalizeWhitespace(text.slice(start, end));
    if (!snippet || seen.has(snippet)) continue;
    seen.add(snippet);
    windows.push(`[${signal.id} ${signal.type}] ${snippet}`);
  }
  return windows;
}

function resolveSignalIndex(text, signal) {
  if (Number.isSafeInteger(signal.startIndex) && signal.startIndex >= 0 && signal.startIndex < text.length) {
    return signal.startIndex;
  }
  const signalText = String(signal.text ?? "").trim();
  if (!signalText) return -1;
  return text.indexOf(signalText);
}

function formatLink(link, index) {
  return [
    `${index + 1}.`,
    link.text ? `text=${link.text}` : undefined,
    link.role ? `role=${link.role}` : undefined,
    `url=${link.url}`,
  ].filter(Boolean).join(" ");
}

function formatMiniProgram(miniProgram, index) {
  return [
    `${index + 1}.`,
    miniProgram.text ? `text=${miniProgram.text}` : undefined,
    miniProgram.actionType ? `action=${miniProgram.actionType}` : undefined,
    miniProgram.appId ? `appId=${miniProgram.appId}` : undefined,
    miniProgram.path ? `path=${miniProgram.path}` : undefined,
    miniProgram.url ? `url=${miniProgram.url}` : undefined,
  ].filter(Boolean).join(" ");
}

function formatImage(image, index) {
  return [
    `${index + 1}.`,
    image.id ? `id=${image.id}` : undefined,
    image.role ? `role=${image.role}` : undefined,
    image.alt ? `alt=${image.alt}` : undefined,
    image.textContent ? `text=${image.textContent}` : undefined,
    image.sourceUrl ? `sourceUrl=${image.sourceUrl}` : undefined,
    image.path ? `path=${image.path}` : undefined,
    image.storagePath ? `storagePath=${image.storagePath}` : undefined,
    image.width ? `width=${image.width}` : undefined,
    image.height ? `height=${image.height}` : undefined,
  ].filter(Boolean).join(" ");
}

function enforceMaxChars(text, maxChars) {
  const limit = Number.isSafeInteger(maxChars) && maxChars > 0 ? maxChars : 6000;
  if (text.length <= limit) return { text, truncated: false };
  const marker = "\n[truncated]";
  if (limit <= marker.length) return { text: text.slice(0, limit), truncated: true };
  return {
    text: `${text.slice(0, limit - marker.length)}${marker}`,
    truncated: true,
  };
}

function retainedPrefixLength({ packetText, truncated }) {
  if (!truncated) return packetText.length;
  const markerIndex = packetText.indexOf("\n[truncated]");
  return markerIndex >= 0 ? markerIndex : packetText.length;
}

function truncateText(text, maxChars) {
  const value = String(text ?? "");
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 12)} [truncated]`;
}

function truncateFromEnd(text, maxChars) {
  const value = String(text ?? "");
  return value.length <= maxChars ? value : `[tail]\n${value.slice(value.length - maxChars)}`;
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
