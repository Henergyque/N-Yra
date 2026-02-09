# M-Yra Assistante Discord

A multi-provider Discord assistant that routes requests to the best model.

## Setup

1. Copy `.env.example` to `.env` and fill in your keys.
2. Install deps:
   - `npm install`
3. Run:
   - `npm run dev`

## Behavior

- Short, clear replies (1-4 sentences)
- No emojis
- Minimal questions unless required
- Routes between OpenAI, Claude, Gemini, Grok, and Perplexity

## Routing

The router uses an LLM to pick the provider. If that fails, it falls back to simple rules.

## Notes

- Set `RESPOND_TO_MENTIONS_ONLY=true` to avoid replying to every message.

## Memory

Short context (in RAM, not persisted):

- `MEMORY_ENABLED` (true/false)
- `MEMORY_SCOPE` (`user`, `channel`, `user_channel`)
- `MEMORY_MAX_MESSAGES` (default 6)
- `MEMORY_TTL_MINUTES` (default 120)

First-name profile (persisted via Redis):

- The bot can store a first name only, with confirmation.
- Use "oublie-moi" to delete it.
- Set `REDIS_URL` from Railway Redis.
- Toggle with `NAME_MEMORY_ENABLED`.

Creator profile (persisted):

- Set `CREATOR_USER_ID` to the Discord user id of the creator.
- Set `CREATOR_TITLE` to the label (example: "maman", "creatrice").
- The bot will answer creator questions with a mention.
