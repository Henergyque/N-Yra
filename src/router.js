import { ROUTER_SYSTEM, getSystemPrompt } from "./prompts.js";
import {
  compactWhitespace,
  extractJsonObject,
  fetchBinary,
  stripEmojis,
  trimSentences
} from "./utils.js";
import * as openai from "./providers/openai.js";
import * as anthropic from "./providers/anthropic.js";
import * as gemini from "./providers/gemini.js";
import * as grok from "./providers/grok.js";
import * as perplexity from "./providers/perplexity.js";
import * as mistral from "./providers/mistral.js";
import { generateImage as generateOpenAIImage } from "./providers/openaiImage.js";
import { generateImage as generateStabilityImage } from "./providers/stabilityImage.js";

const PROVIDERS = {
  openai,
  claude: anthropic,
  gemini,
  grok,
  perplexity,
  mistral
};

const DEFAULT_PROVIDER = "openai";
const MAX_INLINE_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mpeg", "mpg", "mov", "avi", "webm", "wmv", "flv", "3gp"]);

export async function routeMessage({ text, config }) {
  const decision = await routeWithLLM({ text, config });
  if (decision) return decision;
  return routeWithRules(text);
}

export function getMediaInput({ text, attachments }) {
  const items = Array.isArray(attachments) ? attachments : [];
  const videoAttachment = items.find((attachment) => isVideoAttachment(attachment));
  if (videoAttachment) return { type: "video", attachment: videoAttachment };

  const youtubeUrl = findYouTubeUrl(text);
  if (youtubeUrl) return { type: "youtube", url: youtubeUrl };

  const imageAttachment = items.find((attachment) => isImageAttachment(attachment));
  if (imageAttachment) return { type: "image", attachment: imageAttachment };

  return null;
}

export async function generateReply({ provider, text, config, task, context }) {
  if (provider === "openai" && isImagePrompt(text)) {
    return generateImageReply({ text, config });
  }

  const client = PROVIDERS[provider] || PROVIDERS[DEFAULT_PROVIDER];
  const apiKey = getApiKey(provider, config);
  const model = getModel(provider, config, task);

  const raw = await client.generate({
    apiKey,
    model,
    system: getSystemPrompt(config?.assistantName),
    user: buildContextPrompt(context, text),
    maxTokens: 512
  });

  return postProcess(raw, config.maxReplySentences);
}

export async function generateMediaReply({ text, config, media, context }) {
  if (!media) return "";
  if (!config.geminiApiKey) {
    return "Je ne peux pas analyser sans cle Gemini.";
  }

  const userText = normalizeMediaPrompt(text, media);
  const promptText = `${getSystemPrompt(config?.assistantName)}\n\n${buildContextPrompt(context, userText)}`;

  if (media.type === "youtube") {
    const parts = [
      { file_data: { file_uri: media.url } },
      { text: promptText }
    ];
    const raw = await gemini.generateWithParts({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      parts,
      maxTokens: 512
    });
    return postProcess(raw, config.maxReplySentences);
  }

  const mediaData = await fetchBinary(media.attachment.url);
  if (mediaData.sizeBytes > MAX_INLINE_BYTES) {
    return media.type === "video"
      ? "Video trop lourde. Envoie un extrait plus court ou un lien YouTube."
      : "Image trop lourde. Envoie une version plus legere.";
  }

  const mimeType = resolveMimeType(media.attachment, mediaData.contentType, media.type);
  const parts = [
    {
      inline_data: {
        data: mediaData.buffer.toString("base64"),
        mime_type: mimeType
      }
    },
    { text: promptText }
  ];

  const raw = await gemini.generateWithParts({
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
    parts,
    maxTokens: 512
  });

  return postProcess(raw, config.maxReplySentences);
}

async function routeWithLLM({ text, config }) {
  const provider = config.routerProvider || DEFAULT_PROVIDER;
  const client = PROVIDERS[provider];
  const apiKey = getApiKey(provider, config);
  const model = config.routerModel || getModel(provider, config);
  if (!client || !apiKey || !model) return null;

  const raw = await client.generate({
    apiKey,
    model,
    system: ROUTER_SYSTEM,
    user: text,
    maxTokens: 200
  });

  const json = extractJsonObject(raw);
  if (!json?.provider) return null;
  const selected = String(json.provider).toLowerCase();
  if (!PROVIDERS[selected]) return null;

  return {
    provider: selected,
    task: normalizeTask(json.task),
    reason: json.reason || "",
    urgency: json.urgency || "normal"
  };
}

function routeWithRules(text) {
  const lower = text.toLowerCase();
  if (isImagePrompt(lower)) {
    return { provider: "openai", task: "image", reason: "image request", urgency: "normal" };
  }
  if (/(sources?|citations?|news|latest|search)/.test(lower)) {
    return { provider: "perplexity", task: "search", reason: "info retrieval", urgency: "normal" };
  }
  if (/(tldr|tl;dr|resume|summary|bref|court|en 1 phrase|en une phrase|ultra court|tres court)/.test(lower)) {
    return { provider: "mistral", task: "general", reason: "ultra short response", urgency: "normal" };
  }
  if (/(sex|porn|nude|explicit|kink)/.test(lower)) {
    return { provider: "grok", task: "explicit", reason: "edgy or explicit", urgency: "normal" };
  }
  if (/(code|bug|debug|error|stack|function|class|script|typescript|javascript|python|java|c\+\+)/.test(lower)) {
    return { provider: "openai", task: "code", reason: "coding request", urgency: "normal" };
  }
  if (/(article|resume|summary|summarize|writeup|blog|long form)/.test(lower)) {
    return { provider: "claude", task: "article", reason: "structured writing", urgency: "normal" };
  }
  if (/(analyze|reason|proof|rigorous)/.test(lower)) {
    return { provider: "claude", task: "general", reason: "deep reasoning", urgency: "normal" };
  }
  return { provider: "openai", task: "general", reason: "default", urgency: "normal" };
}

function postProcess(text, maxSentences) {
  const cleaned = compactWhitespace(stripEmojis(text || ""));
  return trimSentences(cleaned, maxSentences || 4);
}

function getApiKey(provider, config) {
  if (provider === "openai") return config.openaiApiKey;
  if (provider === "claude") return config.anthropicApiKey;
  if (provider === "gemini") return config.geminiApiKey;
  if (provider === "grok") return config.xaiApiKey;
  if (provider === "perplexity") return config.perplexityApiKey;
  if (provider === "mistral") return config.mistralApiKey;
  return null;
}

function getModel(provider, config, task) {
  if (provider === "openai") {
    if (task === "code" && config.openaiCodeModel) return config.openaiCodeModel;
    return config.openaiModel;
  }
  if (provider === "claude") return config.claudeModel;
  if (provider === "gemini") return config.geminiModel;
  if (provider === "grok") return config.grokModel;
  if (provider === "perplexity") return config.perplexityModel;
  if (provider === "mistral") return config.mistralModel;
  return null;
}

function normalizeTask(task) {
  const value = String(task || "general").toLowerCase();
  if (["general", "code", "search", "article", "image", "explicit"].includes(value)) {
    return value;
  }
  return "general";
}

function isImagePrompt(text) {
  return /(image|picture|photo|illustration|dessin|generate image|create image)/i.test(text);
}

function buildContextPrompt(context, text) {
  if (!context) return text;
  return `Contexte court:\n${context}\nUser: ${text}`;
}

function isImageAttachment(attachment) {
  const mime = String(attachment?.contentType || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  const ext = getFileExtension(attachment?.name);
  return ext ? IMAGE_EXTENSIONS.has(ext) : false;
}

function isVideoAttachment(attachment) {
  const mime = String(attachment?.contentType || "").toLowerCase();
  if (mime.startsWith("video/")) return true;
  const ext = getFileExtension(attachment?.name);
  return ext ? VIDEO_EXTENSIONS.has(ext) : false;
}

function getFileExtension(filename) {
  const match = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function resolveMimeType(attachment, fallbackMime, mediaType) {
  const mime = String(attachment?.contentType || fallbackMime || "").toLowerCase();
  if (mime) return mime;
  const ext = getFileExtension(attachment?.name);
  if (mediaType === "video") {
    if (ext === "webm") return "video/webm";
    if (ext === "mov") return "video/mov";
    if (ext === "avi") return "video/avi";
    if (ext === "mpeg" || ext === "mpg") return "video/mpeg";
    if (ext === "wmv") return "video/wmv";
    if (ext === "flv") return "video/x-flv";
    if (ext === "3gp") return "video/3gpp";
    return "video/mp4";
  }

  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  if (ext === "tiff") return "image/tiff";
  if (ext === "png") return "image/png";
  return "image/jpeg";
}

function normalizeMediaPrompt(text, media) {
  const raw = String(text || "").trim();
  const cleaned = media?.url ? raw.replace(media.url, "").trim() : raw;
  return cleaned || "Decris ce contenu.";
}

function findYouTubeUrl(text) {
  const match = String(text || "").match(
    /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[^\s&]+|youtu\.be\/[^\s&]+))/i
  );
  return match ? match[1] : "";
}

async function generateImageReply({ text, config }) {
  if (!config.openaiApiKey) {
    return generateStabilityImageReply({ text, config });
  }

  const model = config.openaiImageModel || "gpt-image-1.5";
  let imageUrl = "";

  try {
    imageUrl = await generateOpenAIImage({
      apiKey: config.openaiApiKey,
      model,
      prompt: text
    });
  } catch (error) {
    console.warn("OpenAI image error:", error?.message || error);
    if (isCreditError(error)) {
      console.warn("OpenAI image credits may be exhausted.");
    }
    imageUrl = "";
  }

  if (!imageUrl) {
    imageUrl = await generateStabilityImageReply({ text, config, silent: true });
  }

  if (!imageUrl) {
    return "Je n ai pas pu generer l image.";
  }

  if (imageUrl.startsWith("data:image/")) {
    return imageUrl;
  }

  return `Voici l image : ${imageUrl}`;
}

async function generateStabilityImageReply({ text, config, silent }) {
  if (!config.stabilityApiKey) {
    return silent ? "" : "Je ne peux pas generer d image sans cle Stability AI.";
  }

  const model = config.stabilityModel || "sd3.5-large";
  try {
    const imageUrl = await generateStabilityImage({
      apiKey: config.stabilityApiKey,
      model,
      prompt: text
    });

    return imageUrl;
  } catch (error) {
    console.warn("Stability image error:", error?.message || error);
    if (isCreditError(error)) {
      console.warn("Stability AI credits may be exhausted.");
    }
    return "";
  }
}

function isCreditError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("credit") || message.includes("insufficient") || message.includes("balance");
}
