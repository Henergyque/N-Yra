import { fetchJson } from "../utils.js";

export async function generate({ apiKey, model, system, user, maxTokens }) {
  const url = "https://api.anthropic.com/v1/messages";
  const body = {
    model,
    max_tokens: maxTokens,
    temperature: 0.4,
    system,
    messages: [{ role: "user", content: user }]
  };

  const data = await fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });

  const content = data?.content?.[0]?.text;
  return content ? content.trim() : "";
}
