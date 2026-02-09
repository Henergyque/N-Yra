import { fetchJson } from "../utils.js";

export async function generateImage({ apiKey, model, prompt }) {
  const url = "https://api.openai.com/v1/images/generations";
  const body = {
    model,
    prompt,
    size: "1024x1024",
    response_format: "url"
  };

  const data = await fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  const image = data?.data?.[0];
  if (image?.url) return image.url;
  if (image?.b64_json) return `data:image/png;base64,${image.b64_json}`;
  return "";
}
