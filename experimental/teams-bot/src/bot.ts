// SPDX-License-Identifier: AGPL-3.0-only
//
// The bot: one Chat instance, the Teams adapter, and the inbound event handlers.
// This is the "one codebase" half of the Chat SDK pitch — the same handlers would
// fire for Slack/Discord if we added those adapters, without touching this file.

import { Chat } from "chat";
import type { Adapter } from "chat";
import { createTeamsAdapter } from "@chat-adapter/teams";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";

import { rememberConversation } from "./store.js";

// Load whichever platform adapters have credentials in the environment. The same
// handlers below run for all of them — this is the "one codebase, every platform"
// promise of the Chat SDK. Add a workspace's creds and that platform lights up.
const adapters: Record<string, Adapter> = {};

if (process.env.TEAMS_APP_ID) {
  // Auto-detects TEAMS_APP_ID / TEAMS_APP_PASSWORD (+ optional TEAMS_APP_TENANT_ID).
  // appType defaults to MultiTenant; a single-tenant Azure Bot needs SingleTenant.
  adapters.teams = createTeamsAdapter(
    process.env.TEAMS_APP_TYPE === "SingleTenant" ? { appType: "SingleTenant" } : undefined,
  );
}

if (process.env.SLACK_BOT_TOKEN) {
  // Socket mode (SLACK_APP_TOKEN present): the adapter opens a WebSocket to Slack
  // on bot.initialize() — no public URL, no request-URL verification, works behind
  // any firewall. Ideal for a personal workspace.
  // Webhook mode (no app token): signingSecret auto-detects from
  // SLACK_SIGNING_SECRET and Slack POSTs to /slack/events instead.
  adapters.slack = process.env.SLACK_APP_TOKEN
    ? createSlackAdapter({
        botToken: process.env.SLACK_BOT_TOKEN,
        appToken: process.env.SLACK_APP_TOKEN,
        mode: "socket",
      })
    : createSlackAdapter({ botToken: process.env.SLACK_BOT_TOKEN });
}

export const activeAdapters = Object.keys(adapters);
if (activeAdapters.length === 0) {
  throw new Error(
    "No adapters configured. Set TEAMS_APP_ID (+password) and/or SLACK_BOT_TOKEN (+SLACK_SIGNING_SECRET) in .env.",
  );
}

export const bot = new Chat({
  userName: process.env.BOT_USER_NAME ?? "helix",
  adapters,
  // In-memory state is fine for a single-process prototype. Production swaps this
  // for createRedisState() so subscriptions / locks survive restarts and scale out.
  state: createMemoryState(),
  logger: "info",
});

// --- Inbound: someone @mentions the bot in a channel -------------------------
// onNewMention only fires for mentions in threads the bot is NOT yet subscribed
// to. We subscribe so follow-up replies in the same thread route to
// onSubscribedMessage instead, and we record the thread so /emit can reach it.
bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  rememberConversation({
    threadId: thread.id,
    authorId: message.author.userId,
    label: `mention from ${message.author.fullName}`,
  });
  await thread.post(
    [
      `Hi ${message.author.fullName} 👋 — I'm the Helix bot prototype.`,
      "",
      "I'm now watching this thread. Try:",
      "• `status` — I'll report a fake device status",
      "• anything else — I'll echo it back",
      "",
      "Your server can also push a notification into this thread via `POST /emit`.",
    ].join("\n"),
  );
});

// --- Inbound: the bot is DM'd directly ---------------------------------------
bot.onDirectMessage(async (thread, message) => {
  await thread.subscribe();
  rememberConversation({
    threadId: thread.id,
    authorId: message.author.userId,
    label: `DM with ${message.author.fullName}`,
  });
  await thread.post(`Got your DM: “${message.text}”. I'll remember this conversation.`);
});

// --- Inbound: a follow-up in a subscribed thread -----------------------------
// This is the "reply to events from Teams" path: after the bot posts a
// notification, whatever the user types back lands here.
bot.onSubscribedMessage(async (thread, message) => {
  rememberConversation({
    threadId: thread.id,
    authorId: message.author.userId,
    label: `thread with ${message.author.fullName}`,
  });

  const text = message.text.trim();
  if (/^status\b/i.test(text)) {
    await thread.post("🟢 kitchen-sensor — online · battery 81% · last seen 12s ago");
    return;
  }
  await thread.post(`You said: “${text}”`);
});

// --- Inbound: a button click on a card we posted -----------------------------
// Cards posted by /emit include Approve / Ack buttons; this is where the click
// comes back. It closes the loop: server → Teams card → user click → server.
bot.onAction(async (event) => {
  await event.thread?.post(
    `✅ Action received: **${event.actionId}** (by ${event.user.fullName})`,
  );
});
