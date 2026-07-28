// SPDX-License-Identifier: AGPL-3.0-only
//
// Tiny in-memory conversation registry: remembers inbound threads so /emit has somewhere to send.

export interface KnownConversation {
  /** Full Chat SDK thread id, e.g. "teams:<serviceUrl>:<conversationId>:..." */
  threadId: string;
  /** Platform user id of the person we last talked to (for openDM). */
  authorId?: string;
  /** Human label for logs / the /emit UI. */
  label: string;
  lastSeen: number;
}

const conversations = new Map<string, KnownConversation>();

export function rememberConversation(c: Omit<KnownConversation, "lastSeen">): void {
  conversations.set(c.threadId, { ...c, lastSeen: Date.now() });
}

export function listConversations(): KnownConversation[] {
  return [...conversations.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

export function latestConversation(): KnownConversation | undefined {
  return listConversations()[0];
}
