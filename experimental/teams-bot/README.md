<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Helix chat bot — prototype (Vercel Chat SDK)

An experimental, minimal bot built on the **Vercel Chat SDK** (`npm i chat`). One
codebase, multiple platforms: the same handlers run on **Slack** and **Microsoft
Teams** — add a workspace's credentials and that platform lights up. It answers
four questions with running code:

1. How is a bot created and installed on each platform?
2. How does the platform reach *my* server?
3. Can my server **emit notifications** (server-initiated, no user prompt)?
4. Can users **reply to those events** and have my server react?

The handlers in `src/bot.ts` are platform-neutral — adding Slack meant one
adapter and one route, no handler changes. That is the whole point of the Chat
SDK. **Slack is the easiest to try** (free workspace, Socket Mode = no public
URL); Teams needs an Azure Bot + a business/dev M365 account.

> The directory is still named `teams-bot/` for historical reasons; it now hosts
> both adapters.

> Status: prototype. In-memory state, no auth/identity mapping, single process.
> See [Limitations & next steps](#limitations--next-steps).

---

## The shape of it

```
   Teams cloud                     this server (localhost:3978)
   ───────────                     ────────────────────────────
                    Cloudflare
   user @mentions ──► tunnel ──►  POST /api/messages ──► Chat SDK ──► bot.ts handlers
   user clicks card    (https)                             (parses + dispatches)
                                                                 │
   message appears ◄──────────────────────────────────────  thread.post(...)
   in Teams                                                      ▲
                                                                 │
   Helix alert pipeline / OTA job ──►  POST /emit  ──────────────┘
                                       POST /emit/card         (proactive: no user input)
```

Two roles share one process, and the split is deliberate:

- **`/api/messages`** is Teams' endpoint (inbound). The Azure Bot's *messaging
  endpoint* points here. Chat SDK validates the Bot Framework JWT, parses the
  activity, and dispatches to the handlers in `src/bot.ts`.
- **`/emit`, `/emit/card`** model *your* side (outbound/proactive). Any Helix
  process calls these to push a notification into Teams. In-process you'd skip
  HTTP and call `bot.thread(id).post(...)` directly.

This mirrors the Helix architecture goal: the bot never touches the database —
a notification service (or the tRPC/REST APIs the web UI already uses) drives it,
so RBAC, audit, and workflows stay in one place.

### File map

| File | Role |
| --- | --- |
| `src/bot.ts` | The one Chat instance + Teams adapter + **inbound** handlers (mention, DM, follow-up, button click). Platform-agnostic. |
| `src/server.ts` | HTTP surface: Teams webhook + the **proactive** `/emit` endpoints. |
| `src/cards.tsx` | A reusable Adaptive Card (JSX) with Acknowledge / Reboot buttons. |
| `src/store.ts` | In-memory conversation registry — stands in for the Helix↔Teams identity/conversation mapping a real deployment would persist. |
| `manifest/` | `slack-app-manifest.yaml` (Slack) + `manifest.json` + icons (Teams sideload). |

---

## Run it live — Slack (Socket Mode, easiest)

No public URL, no tunnel, no URL verification. You just need a Slack workspace
you can install apps into.

1. **Create the app.** [api.slack.com/apps](https://api.slack.com/apps) → **Create
   New App** → **From an app manifest** → pick your workspace → paste
   `manifest/slack-app-manifest.yaml` → **Create**.
2. **App-Level Token.** **Basic Information** → **App-Level Tokens** → **Generate**
   → scope **`connections:write`** → copy the `xapp-…` token → `SLACK_APP_TOKEN`.
3. **Install + Bot Token.** **Install App** → **Install to Workspace** → allow →
   copy **Bot User OAuth Token** (`xoxb-…`) → `SLACK_BOT_TOKEN`.
4. **Configure & run:**
   ```sh
   cd experimental/teams-bot
   npm install
   # .env:
   #   SLACK_BOT_TOKEN=xoxb-...
   #   SLACK_APP_TOKEN=xapp-...
   npm run dev
   ```
   The log shows `active adapters: slack` and the socket connects.
5. **Try it** (in Slack): DM the bot, or `/invite @helix` to a channel then
   `@helix hello`. It greets and subscribes. Then push a notification from your
   side:
   ```sh
   curl -X POST http://localhost:3978/emit \
     -H 'content-type: application/json' \
     -d '{"text":"🔴 kitchen-sensor went offline 2m ago"}'
   curl -X POST http://localhost:3978/emit/card -H 'content-type: application/json' -d '{}'
   ```
   The card's Acknowledge / Reboot buttons post back to `bot.onAction`. Because
   `/emit` targets a thread id (`bot.thread(id)` infers the platform), the exact
   same endpoint drives Slack and Teams.

> **Webhook mode instead** (no app token): leave `SLACK_APP_TOKEN` unset, set
> `SLACK_SIGNING_SECRET`, point the app's Event Subscriptions + Interactivity
> request URLs at `https://teams-bot.hardikja.in/slack/events`, and enter/verify
> those URLs *after* the bot is running (the signing secret only exists once the
> app is created).

---

## Run it live — Microsoft Teams

You need: an **Azure account** (free tier is fine) and a **Microsoft 365 tenant**
with Teams and app sideloading allowed. The code needs a **public HTTPS URL**
because Teams only calls internet-reachable endpoints — we use the existing
Cloudflare tunnel.

### 1. Register an Azure Bot (gives you App ID + secret)

1. Azure Portal → **Create a resource** → **Azure Bot**.
2. Type of App: **Multi Tenant** (matches the default `createTeamsAdapter()`).
   Let Azure create a new **Microsoft App ID**.
3. After creation → **Configuration** → set **Messaging endpoint** to:
   `https://teams-bot.hardikja.in/api/messages`
4. **Configuration → Manage Password** (App registration) → **New client
   secret** → copy the *value* (not the secret ID).
5. **Channels** → add the **Microsoft Teams** channel.

You now have `TEAMS_APP_ID` (the App ID) and `TEAMS_APP_PASSWORD` (the secret
value). For a Single-Tenant bot instead, also set `TEAMS_APP_TENANT_ID` and
`TEAMS_APP_TYPE=SingleTenant`.

### 2. Expose the server through Cloudflare

Add an ingress rule to the tunnel (on the host running `cloudflared`) and a DNS
route, then restart:

```sh
# /root/.cloudflared/config.yml — add under ingress:, before the 404 catch-all:
#   - hostname: teams-bot.hardikja.in
#     service: http://localhost:3978

sudo cloudflared tunnel route dns 53e48e60-e6b3-4860-bd04-73ef9d863f7d teams-bot.hardikja.in
sudo systemctl restart cloudflared   # or: restart the cloudflared process
```

`https://teams-bot.hardikja.in/health` should return `{"ok":true}` once the bot
is running (next step).

### 3. Configure & start the bot

```sh
cd experimental/teams-bot
npm install
cp .env.example .env      # fill in TEAMS_APP_ID + TEAMS_APP_PASSWORD
npm run dev               # tsx watch; listens on :3978
```

### 4. Package & sideload the Teams app

1. Edit `manifest/manifest.json` — replace both `PASTE-YOUR-BOT-APP-ID-HERE`
   occurrences (`id` and `bots[0].botId`) with your App ID.
2. Zip the *contents* of `manifest/` (the three files at the zip root, not the
   folder):
   ```sh
   cd manifest && zip ../helix-teams-bot.zip manifest.json color.png outline.png && cd ..
   ```
3. Teams → **Apps** → **Manage your apps** → **Upload an app** → **Upload a
   custom app** → pick the zip. (Requires custom-app upload to be enabled in the
   tenant's Teams admin settings.)
4. **Add** the app (personal scope is simplest to start).

---

## The demo

Once installed and the tunnel is live:

**Inbound + subscribe**

- DM the bot, or `@Helix (dev)` it in a channel → it greets you and subscribes
  to the thread. Check `GET https://teams-bot.hardikja.in/conversations` — the
  thread is now recorded.
- Reply `status` → it returns a fake device status. Reply anything → it echoes.

**Proactive notification (server → Teams)**

```sh
curl -X POST https://teams-bot.hardikja.in/emit \
  -H 'content-type: application/json' \
  -d '{"text":"🔴 kitchen-sensor went offline 2m ago"}'
```

A message appears in Teams **with no user prompt** — this is the notification
path. (`threadId` is optional; omitted, it targets the most recent conversation.)

**Interactive card + reply loop (Teams → server)**

```sh
curl -X POST https://teams-bot.hardikja.in/emit/card \
  -H 'content-type: application/json' \
  -d '{"device":"kitchen-sensor","title":"🔴 Device offline","detail":"Lost heartbeat 2m ago"}'
```

A card with **Acknowledge** / **Reboot device** buttons appears. Clicking a
button posts back to `POST /api/messages`, routes to `bot.onAction`, and the bot
confirms — closing the round trip. This is where real Helix logic (ack an alarm,
queue an OTA, hit MQTT) would run.

---

## Limitations & next steps

- **Identity.** `src/store.ts` just remembers conversations seen inbound. Real
  Helix needs an OAuth "Connect Helix" step mapping a Teams user id → a Helix
  user/UUID/roles, so incoming commands authorize against existing RBAC.
- **`openDM` / cold proactive.** We post into *known* threads. DMing a user the
  bot has never talked to needs a stored conversation reference (or Microsoft
  Graph install), which requires `TEAMS_APP_TENANT_ID` + Graph permissions.
- **State.** In-memory `createMemoryState()` loses subscriptions on restart and
  won't scale out — swap for `createRedisState()` (Chat SDK ships the adapter).
- **Multi-platform.** Add `slack`/`discord` adapters to the `adapters` map; the
  handlers in `bot.ts` are already platform-neutral.
- **Not wired to Helix yet.** The `/emit` endpoints and handler bodies are stubs;
  the real version calls Helix notification/command APIs, never the DB directly.

## Why the Chat SDK (vs. Teams-native)

Microsoft's own path is the Bot Framework SDK / Teams SDK — Teams-only. The
Vercel Chat SDK wraps that adapter and normalizes mentions, threads, cards, and
buttons across Slack/Teams/Discord/etc. behind one API, which is exactly the
"one bot service, many platforms" model Helix wants. This prototype only proves
the Teams adapter; the abstraction is what makes it worth adopting.
