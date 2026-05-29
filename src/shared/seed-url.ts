const TRAILING_URL_PUNCTUATION = /[。，“”‘’'")\]}>,]+$/u;

export function extractFirstHttpUrl(input: string): string | null {
  const match = input.trim().match(/https?:\/\/[^\s<>"'，。]+/u);
  if (!match) return null;

  const candidate = match[0].replace(TRAILING_URL_PUNCTUATION, "");
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}
