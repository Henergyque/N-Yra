import { fetchJson } from "../utils.js";

export async function generateImage({ apiKey, model, prompt }) {
  const url = "https://api.stability.ai/v2beta/stable-image/generate/sd3";
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("model", model);
  form.append("output_format", "png");

  const data = await fetchJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json"
    },
    body: form
  });

  const image = data?.image || data?.data?.[0]?.b64_json || data?.b64_json;
  if (!image) return "";
  return `data:image/png;base64,${image}`;
}
