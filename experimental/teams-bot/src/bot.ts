// SPDX-License-Identifier: AGPL-3.0-only
//
// One Chat instance, platform adapters, and the inbound event handlers.

import { Chat } from "chat";
import type { Adapter } from "chat";
import { createTeamsAdapter } from "@chat-adapter/teams";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";

import { rememberConversation } from "./store.js";

// Load whichever platform adapters have credentials in the environment; the same handlers run for all.
const adapters: Record<string, Adapter> = {};

if (process.env.TEAMS_APP_ID) {
  // appType defaults to MultiTenant; a single-tenant Azure Bot needs SingleTenant.
  adapters.teams = createTeamsAdapter(
    process.env.TEAMS_APP_TYPE === "SingleTenant" ? { appType: "SingleTenant" } : undefined,
  );
}

if (process.env.SLACK_BOT_TOKEN) {
  // With SLACK_APP_TOKEN: socket mode (WebSocket, no public URL). Without: webhook mode POSTing to /slack/events.
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
  // In-memory state is fine for a single-process prototype; production swaps for createRedisState().
  state: createMemoryState(),
  logger: "info",
});

// Subscribe so follow-up replies route to onSubscribedMessage, and record the thread so /emit can reach it.
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

bot.onDirectMessage(async (thread, message) => {
  await thread.subscribe();
  rememberConversation({
    threadId: thread.id,
    authorId: message.author.userId,
    label: `DM with ${message.author.fullName}`,
  });
  await thread.post(`Got your DM: “${message.text}”. I'll remember this conversation.`);
});

// A follow-up in a subscribed thread: whatever the user types after the bot posts lands here.
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

// A button click on a card we posted comes back here (server -> card -> click -> server).
bot.onAction(async (event) => {
  await event.thread?.post(
    `✅ Action received: **${event.actionId}** (by ${event.user.fullName})`,
  );
});
