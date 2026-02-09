import { fetchJson } from "../utils.js";

export async function generate({ apiKey, model, system, user, maxTokens }) {
  const url = "https://api.perplexity.ai/chat/completions";
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    max_tokens: maxTokens,
    temperature: 0.3
  };

  const data = await fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  return data?.choices?.[0]?.message?.content?.trim() || "";
}
