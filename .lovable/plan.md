## Goal

Let Reelable's chat call Pika's video models through Pika's remote MCP server (`https://mcp.pika.me/api/mcp`). When the director decides "generate a 5s clip of X," it calls a Pika MCP tool, the resulting video URL is attached as a project asset, and it shows up in the chat + Assets strip just like generated images do today.

## Approach: shared workspace connection

The app currently has no user auth. Rather than introducing accounts just for this, we treat Pika as a single shared connection for the whole studio: one OAuth flow, one set of tokens stored server-side, used for every chat turn. (We can split it per-user later if you add auth.) If you'd rather each visitor connect their own Pika account, say so and I'll switch to a per-session/per-user model.

## What gets built

1. **Enable Lovable Cloud** — needed to persist OAuth tokens + dynamic client registration across server restarts. One small `pika_connection` table (singleton row: tokens, refresh token, expires_at, client registration JSON).
2. **MCP client + auth provider** (`src/lib/pika-mcp.server.ts`)
   - Uses `@ai-sdk/mcp` `createMCPClient` with HTTP transport against `https://mcp.pika.me/api/mcp`.
   - Implements the AI SDK `OAuthClientProvider` interface: load/save tokens, load/save dynamic client registration, capture authorization URL, redirect URL points at our callback.
   - Serves `/.well-known/oauth-client` with our client metadata (HTTPS only — Lovable preview/published URLs are HTTPS).
3. **Server routes**
   - `POST /api/pika/connect` → opens a probe MCP client; if it needs auth, returns `{ state: "authenticating", authUrl }`; if it already has tokens, returns `{ state: "ready" }`.
   - `GET  /api/pika/status` → returns `{ state }` so the UI can show Connect / Connected.
   - `GET  /api/pika/oauth/callback` → completes the OAuth code exchange, persists tokens, shows a small "Connected — you can close this tab" page.
   - `POST /api/pika/disconnect` → wipes the row.
4. **Chat wiring** (`src/routes/api/chat.ts`)
   - On each request, if Pika is `ready`, open a short-lived MCP client, call `client.tools()`, namespace them under `pika_*`, and merge into the existing tool map alongside `generate_image` / `search_stock_media` / `commit_project_patch`.
   - Always close the client in `onFinish` and on error.
   - Bump `stepCountIs` accordingly (already at 50+).
5. **Result handling** — extend the existing tool-output sweep in `studio.tsx` to detect Pika tool outputs that contain a video URL and `onPatch({ assetsAppend: [{ kind: "video", mime: "video/mp4", url, … }] })`. The Assets strip + chat bubble already render video assets.
6. **Director prompt update** — short addition to `SYSTEM_PROMPT` telling Reelable that Pika tools exist for actual video generation (and image/audio gen too if exposed), and when to use them vs the existing image tool.
7. **Connect UI** — small "Connect Pika" pill in the studio header (next to Share/Export). Shows Connect / Connecting… / Connected. Clicking opens the Pika OAuth URL in a new tab, polls `/api/pika/status` until `ready`.

## Things I'll explicitly *not* do unless you ask

- Per-end-user Pika accounts (would require app auth first).
- Adding non-Pika MCP servers / a generic MCP registry UI.
- Replacing the existing `generate_image` tool — Pika's image models will be available alongside it, the model picks.
- Building Pika's "Skills" plugin system (podcasts/explainers/UGC). Those are Claude-desktop-only slash commands; not relevant here.

## Open questions

1. Shared workspace connection vs per-visitor — confirm shared is fine?
2. After a clip generates, should it auto-attach to the currently active scene, or just land in the Assets strip for the user/director to place? (Default: land in Assets strip, like images do today.)

If both are fine as-stated I'll start with step 1 (enabling Cloud) and work down.
