export function compactWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

export function stripEmojis(text) {
  return text.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "");
}

export function trimSentences(text, maxSentences) {
  if (!text) return text;
  const parts = text.split(/(?<=[.!?])\s+/);
  if (parts.length <= maxSentences) return text.trim();
  return parts.slice(0, maxSentences).join(" ").trim();
}

export function extractJsonObject(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (error) {
    return null;
  }
}

export async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (error) {
      data = { _raw: raw };
    }

    if (!response.ok) {
      const message = data?.error?.message || data?.message || raw || "Request failed";
      throw new Error(message);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchBinary(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const arrayBuffer = await response.arrayBuffer();
    if (!response.ok) {
      const message = response.statusText || "Request failed";
      throw new Error(message);
    }

    const contentType = response.headers.get("content-type") || "";
    const lengthHeader = response.headers.get("content-length");
    const sizeBytes = lengthHeader ? Number(lengthHeader) : arrayBuffer.byteLength;

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType,
      sizeBytes
    };
  } finally {
    clearTimeout(timeout);
  }
}
