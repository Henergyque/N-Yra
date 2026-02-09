import { fetchJson } from "../utils.js";

export async function generate({ apiKey, model, system, user, maxTokens }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: `${system}\n\nUser: ${user}` }]
      }
    ],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.4
    }
  };

  const data = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

export async function generateWithParts({ apiKey, model, parts, maxTokens, temperature = 0.4 }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [
      {
        role: "user",
        parts
      }
    ],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature
    }
  };

  const data = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}
