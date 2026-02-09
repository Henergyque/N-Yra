import "dotenv/config";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { createClient } from "redis";
import { generateMediaReply, generateReply, getMediaInput, routeMessage } from "./router.js";

const config = {
  assistantName: process.env.ASSISTANT_NAME || "M-Yra",
  maxReplySentences: Number(process.env.MAX_REPLY_SENTENCES || 4),
  routerProvider: process.env.ROUTER_PROVIDER || "openai",
  routerModel: process.env.ROUTER_MODEL,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || "gpt-5.2",
  openaiCodeModel: process.env.OPENAI_CODE_MODEL,
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  claudeModel: process.env.CLAUDE_MODEL || "claude-opus-4-6-adaptive",
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || "gemini-3-flash-preview",
  xaiApiKey: process.env.XAI_API_KEY,
  grokModel: process.env.GROK_MODEL || "grok-4",
  perplexityApiKey: process.env.PERPLEXITY_API_KEY,
  perplexityModel: process.env.PERPLEXITY_MODEL || "sonar-reasoning-pro",
  mistralApiKey: process.env.MISTRAL_API_KEY,
  mistralModel: process.env.MISTRAL_MODEL || "mistral-large-2512",
  stabilityApiKey: process.env.STABILITY_API_KEY,
  stabilityModel: process.env.STABILITY_MODEL || "sd3.5-large",
  respondToMentionsOnly: String(process.env.RESPOND_TO_MENTIONS_ONLY || "false") === "true"
};

const MEMORY_ENABLED = String(process.env.MEMORY_ENABLED || "true") === "true";
const MEMORY_MAX_MESSAGES = Number(process.env.MEMORY_MAX_MESSAGES || 6);
const MEMORY_TTL_MS = Number(process.env.MEMORY_TTL_MINUTES || 120) * 60 * 1000;
const MEMORY_SCOPE = process.env.MEMORY_SCOPE || "user_channel";
const memoryStore = new Map();
const NAME_MEMORY_ENABLED = String(process.env.NAME_MEMORY_ENABLED || "true") === "true";
const REDIS_URL = process.env.REDIS_URL || "";
const CREATOR_USER_ID = process.env.CREATOR_USER_ID || "";
const CREATOR_TITLE = process.env.CREATOR_TITLE || "maman";
const pendingNameConfirmations = new Map();

const redis = REDIS_URL
  ? createClient({ url: REDIS_URL })
  : null;

if (redis) {
  redis.on("error", (error) => {
    console.error("Redis error:", error?.message || error);
  });
  try {
    await redis.connect();
    await ensureCreatorProfile();
  } catch (error) {
    console.error("Redis connection failed:", error?.message || error);
  }
}

if (!process.env.DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user?.tag}`);
});

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;

    if (config.respondToMentionsOnly) {
      const isMention = message.mentions.has(client.user?.id || "");
      if (!isMention) return;
    }

    const text = (message.content || "").trim();
    const attachments = Array.from(message.attachments.values());
    if (!text && attachments.length === 0) return;

    if (text) {
      const creatorHandled = await handleCreatorInfo({ message, text });
      if (creatorHandled) return;
      const handled = await handleNameMemory({ message, text });
      if (handled) return;
    }

    const globalContext = await getGlobalContext(message.author?.id);

    await message.channel.sendTyping();
    const media = getMediaInput({ text, attachments });
    if (media) {
      const mediaProvider = "gemini";
      const memoryKey = MEMORY_ENABLED ? getMemoryKey(message, mediaProvider) : "";
      const memoryContext = MEMORY_ENABLED ? buildContextText(getMemoryEntries(memoryKey)) : "";
      const contextText = mergeContext(globalContext, memoryContext);
      const placeholder = await sendProcessingNotice(message);
      const reply = await generateMediaReply({ text, config, media, context: contextText });
      storeMemory(memoryKey, "user", text || describeMedia(media));
      if (reply) {
        await sendReply(message, reply, placeholder);
        storeMemory(memoryKey, "assistant", reply);
      } else if (placeholder) {
        await placeholder.delete();
      }
      return;
    }

    if (!text) return;
    const decision = await routeMessage({ text, config });
    const memoryKey = MEMORY_ENABLED ? getMemoryKey(message, decision.provider) : "";
    const memoryContext = MEMORY_ENABLED ? buildContextText(getMemoryEntries(memoryKey)) : "";
    const contextText = mergeContext(globalContext, memoryContext);
    const placeholder = decision.task === "image" ? await sendProcessingNotice(message) : null;
    const reply = await generateReply({
      provider: decision.provider,
      text,
      config,
      task: decision.task,
      context: contextText
    });

    storeMemory(memoryKey, "user", text);
    if (reply) {
      await sendReply(message, reply, placeholder);
      storeMemory(memoryKey, "assistant", reply);
    } else if (placeholder) {
      await placeholder.delete();
    }
  } catch (error) {
    console.error("Message error:", error.message || error);
  }
});

client.login(process.env.DISCORD_TOKEN);

async function sendProcessingNotice(message) {
  try {
    return await message.reply("Je traite...");
  } catch (error) {
    console.warn("Processing notice failed:", error?.message || error);
    return null;
  }
}

async function sendReply(message, reply, placeholderMessage) {
  const trimmed = String(reply || "").trim();
  if (!trimmed) return;

  const dataMatch = trimmed.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/i);
  if (!dataMatch) {
    if (placeholderMessage) {
      await placeholderMessage.edit(trimmed);
      return;
    }
    await message.reply(trimmed);
    return;
  }

  const extension = dataMatch[1].toLowerCase() === "jpeg" ? "jpg" : dataMatch[1].toLowerCase();
  const buffer = Buffer.from(dataMatch[2], "base64");
  if (placeholderMessage) {
    await placeholderMessage.delete();
  }
  await message.reply({
    files: [{ attachment: buffer, name: `image.${extension}` }]
  });
}

function getMemoryKey(message, provider) {
  if (!MEMORY_ENABLED) return "";
  const safeProvider = provider || "default";
  const userId = message.author?.id || "unknown-user";
  const channelId = message.channel?.id || "unknown-channel";

  if (MEMORY_SCOPE === "user") return `${safeProvider}:${userId}`;
  if (MEMORY_SCOPE === "channel") return `${safeProvider}:${channelId}`;
  return `${safeProvider}:${userId}:${channelId}`;
}

function getMemoryEntries(key) {
  if (!MEMORY_ENABLED || !key) return [];
  const entries = memoryStore.get(key) || [];
  const now = Date.now();
  const fresh = entries.filter((entry) => now - entry.ts <= MEMORY_TTL_MS);
  if (fresh.length !== entries.length) {
    memoryStore.set(key, fresh);
  }
  return fresh;
}

function buildContextText(entries) {
  if (!MEMORY_ENABLED || entries.length === 0) return "";
  return entries
    .map((entry) => `${entry.role === "assistant" ? "Assistant" : "User"}: ${entry.content}`)
    .join("\n");
}

function storeMemory(key, role, content) {
  if (!MEMORY_ENABLED || !key || !content) return;
  const trimmed = String(content || "").trim();
  if (!trimmed) return;

  const now = Date.now();
  const entries = getMemoryEntries(key);
  const updated = [...entries, { role, content: trimmed, ts: now }];
  const capped = updated.slice(-Math.max(1, MEMORY_MAX_MESSAGES));
  memoryStore.set(key, capped);
}

function describeMedia(media) {
  if (!media) return "";
  if (media.type === "youtube") return "Analyse media (youtube)";
  if (media.type === "video") return "Analyse media (video)";
  return "Analyse media (image)";
}

async function handleNameMemory({ message, text }) {
  if (!NAME_MEMORY_ENABLED) return false;
  const userId = message.author?.id;
  if (!userId) return false;

  const lower = text.toLowerCase();
  if (isProfileCommand(lower)) {
    const firstName = await getStoredFirstName(userId);
    if (firstName) {
      await message.reply(`Ton prenom en memoire: ${firstName}.`);
    } else {
      await message.reply("Je n ai pas de prenom en memoire.");
    }
    return true;
  }

  if (isForgetCommand(lower)) {
    await deleteStoredFirstName(userId);
    pendingNameConfirmations.delete(userId);
    await message.reply("Ok, j oublie ton prenom.");
    return true;
  }

  const pending = pendingNameConfirmations.get(userId);
  if (pending && isYesNo(lower)) {
    if (isYes(lower)) {
      await setStoredFirstName(userId, pending);
      await message.reply(`Ok, je retiens: ${pending}.`);
    } else {
      await message.reply("Ok, je ne retiens rien.");
    }
    pendingNameConfirmations.delete(userId);
    return true;
  }

  const candidate = extractFirstName(text);
  if (candidate) {
    pendingNameConfirmations.set(userId, candidate);
    await message.reply(
      `Tu veux que je retienne que tu t appelles ${candidate} ? Reponds oui ou non.`
    );
    return true;
  }

  return false;
}

async function handleCreatorInfo({ message, text }) {
  const creator = await getCreatorProfile();
  if (!creator?.id) return false;
  if (!isCreatorQuestion(text)) return false;

  const label = creator.title || "maman";
  await message.reply(`Ma ${label}, c est <@${creator.id}>.`);
  return true;
}

function isCreatorQuestion(text) {
  return /(qui.*(cree|creer|createur|creatrice)|maman|creator|created you)/i.test(text);
}

function isForgetCommand(text) {
  return /(oublie[- ]moi|oublie moi|forget me)/i.test(text);
}

function isProfileCommand(text) {
  return /^(\/profil|profil|profile)$/i.test(text.trim());
}

function isYesNo(text) {
  return /^(oui|non|yes|no)$/i.test(text.trim());
}

function isYes(text) {
  return /^(oui|yes)$/i.test(text.trim());
}

function extractFirstName(text) {
  const match = text.match(
    /(?:je m'appelle|mon prenom est|appelle-moi)\s+([\p{L}'-]{2,30})/iu
  );
  if (!match) return "";
  return match[1].trim();
}

async function getGlobalContext(userId) {
  if (!NAME_MEMORY_ENABLED || !userId) return "";
  const firstName = await getStoredFirstName(userId);
  if (!firstName) return "";
  return `Prenom utilisateur: ${firstName}.`;
}

function mergeContext(globalContext, memoryContext) {
  if (!globalContext) return memoryContext || "";
  if (!memoryContext) return globalContext;
  return `${globalContext}\n${memoryContext}`;
}

async function getStoredFirstName(userId) {
  if (!redis) return "";
  try {
    const value = await redis.get(`myra:profile:first_name:${userId}`);
    return value || "";
  } catch (error) {
    console.error("Redis get failed:", error?.message || error);
    return "";
  }
}

async function ensureCreatorProfile() {
  if (!redis) return;
  if (!CREATOR_USER_ID) return;
  try {
    const existing = await redis.get("myra:profile:creator_id");
    if (!existing) {
      await redis.set("myra:profile:creator_id", CREATOR_USER_ID);
      await redis.set("myra:profile:creator_title", CREATOR_TITLE);
    }
  } catch (error) {
    console.error("Redis init failed:", error?.message || error);
  }
}

async function getCreatorProfile() {
  if (redis) {
    try {
      const id = await redis.get("myra:profile:creator_id");
      const title = await redis.get("myra:profile:creator_title");
      return { id, title: title || CREATOR_TITLE };
    } catch (error) {
      console.error("Redis get failed:", error?.message || error);
    }
  }

  if (!CREATOR_USER_ID) return null;
  return { id: CREATOR_USER_ID, title: CREATOR_TITLE };
}

async function setStoredFirstName(userId, firstName) {
  if (!redis) return;
  try {
    await redis.set(`myra:profile:first_name:${userId}`, firstName);
  } catch (error) {
    console.error("Redis set failed:", error?.message || error);
  }
}

async function deleteStoredFirstName(userId) {
  if (!redis) return;
  try {
    await redis.del(`myra:profile:first_name:${userId}`);
  } catch (error) {
    console.error("Redis delete failed:", error?.message || error);
  }
}
