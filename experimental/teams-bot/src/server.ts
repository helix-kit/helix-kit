// SPDX-License-Identifier: AGPL-3.0-only
//
// The HTTP surface. Two distinct roles live here:
//
//   1. POST /api/messages  — Teams' side. The Azure Bot's "messaging endpoint"
//      points here (through the Cloudflare tunnel). Every inbound Teams activity
//      (mention, DM, button click) arrives as a POST; we hand the raw Fetch
//      Request straight to the Chat SDK, which parses + dispatches to the
//      handlers in bot.ts.
//
//   2. POST /emit, /emit/card — Helix's side. This models "your server emitting a
//      notification". Any Helix process (an alert pipeline, an OTA job) would call
//      these — or, in-process, call bot.thread(id).post(...) directly — to push a
//      message into Teams without a user having said anything first.
//
// Splitting these makes the round trip obvious: /emit pushes out, /api/messages
// takes replies back in.

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { bot, activeAdapters } from "./bot.js";
import { deviceAlertCard } from "./cards.js";
import { latestConversation, listConversations } from "./store.js";

const app = new Hono();

// --- Platform webhook endpoints ----------------------------------------------
// Each active adapter gets its inbound route. Point the platform's request URL
// (Azure "messaging endpoint" / Slack "Request URL") at the matching path.
const teamsWebhook = bot.webhooks.teams;
if (teamsWebhook) {
  app.post("/api/messages", (c) => teamsWebhook(c.req.raw));
}
const slackWebhook = bot.webhooks.slack;
if (slackWebhook) {
  // One endpoint handles Events API, interactivity, and slash commands, plus
  // Slack's url_verification challenge.
  app.post("/slack/events", (c) => slackWebhook(c.req.raw));
}

// --- Ops ---------------------------------------------------------------------
app.get("/health", (c) => c.json({ ok: true }));

// Inspect which conversations the bot has seen (so you know where /emit will go).
app.get("/conversations", (c) => c.json({ conversations: listConversations() }));

// --- Proactive: plain text notification --------------------------------------
// POST /emit  { "text": "...", "threadId"?: "..." }
// Sends to the given thread, or the most-recently-seen conversation if omitted.
app.post("/emit", async (c) => {
  const body = await c.req
    .json<{ text?: string; threadId?: string }>()
    .catch(() => ({}) as { text?: string; threadId?: string });
  const text = body.text?.trim();
  if (!text) return c.json({ error: "body.text is required" }, 400);

  const threadId = body.threadId ?? latestConversation()?.threadId;
  if (!threadId) {
    return c.json(
      { error: "no known conversation — @mention or DM the bot in Teams first" },
      409,
    );
  }

  const sent = await bot.thread(threadId).post(text);
  return c.json({ ok: true, threadId, messageId: sent.id });
});

// --- Proactive: interactive Adaptive Card ------------------------------------
// POST /emit/card  { "device"?, "title"?, "detail"?, "threadId"? }
// Posts a card with Acknowledge / Reboot buttons; clicks return to bot.onAction.
app.post("/emit/card", async (c) => {
  type CardBody = { device?: string; title?: string; detail?: string; threadId?: string };
  const body = await c.req.json<CardBody>().catch(() => ({}) as CardBody);

  const threadId = body.threadId ?? latestConversation()?.threadId;
  if (!threadId) {
    return c.json(
      { error: "no known conversation — @mention or DM the bot in Teams first" },
      409,
    );
  }

  const card = deviceAlertCard({
    device: body.device ?? "kitchen-sensor",
    title: body.title ?? "🔴 Device offline",
    detail: body.detail ?? "Lost heartbeat 2m ago · site: Bangalore Office · battery 81%",
  });

  const sent = await bot.thread(threadId).post(card);
  return c.json({ ok: true, threadId, messageId: sent.id });
});

// Eagerly initialize so socket-mode adapters (Slack) open their WebSocket now.
// Idempotent — webhook adapters would otherwise init lazily on first request.
// Kept non-fatal so a bad credential surfaces a clear message instead of a raw
// unhandled rejection, and /health stays up.
try {
  await bot.initialize();
} catch (err) {
  console.error(
    "\n⚠️  bot.initialize() failed — check your adapter credentials in .env:\n",
    err instanceof Error ? err.message : err,
    "\n",
  );
}

const port = Number(process.env.PORT ?? 3978);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`helix chat bot listening on http://localhost:${info.port}`);
  console.log(`  active adapters          : ${activeAdapters.join(", ")}`);
  if (activeAdapters.includes("teams")) {
    console.log(`  Teams messaging endpoint : POST /api/messages`);
  }
  if (activeAdapters.includes("slack")) {
    console.log(`  Slack request URL        : POST /slack/events`);
  }
  console.log(`  Proactive notify         : POST /emit  {"text":"..."}`);
  console.log(`  Proactive card           : POST /emit/card`);
});
