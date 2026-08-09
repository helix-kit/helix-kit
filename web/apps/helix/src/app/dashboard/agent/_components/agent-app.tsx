'use client';

import { useRouter } from 'next/navigation';

import { useTRPCMutation, useTRPCQuery } from '@/server/react';
import type { AppRouter } from '@/server/trpc';

import { ChatThread } from './chat-thread';
import { ThreadSidebar } from './thread-sidebar';

import type { inferRouterOutputs } from '@trpc/server';
import type { UIMessage } from 'ai';

export type Conversations = inferRouterOutputs<AppRouter>['conversations']['list'];

// sessionStorage key that hands the first message from the "new chat" composer to
// the freshly-created thread after navigation.
const pendingKey = (id: string) => `helix-agent-pending:${id}`;

// Derive an initial thread title from the first message.
const TITLE_FROM_MESSAGE_LENGTH = 80;

type AgentAppProps = {
  activeId: string | null;
  initialConversations: Conversations;
  initialMessages: unknown[];
};

export const AgentApp = ({ activeId, initialConversations, initialMessages }: AgentAppProps) => {
  const router = useRouter();

  const conversationsQuery = useTRPCQuery((api) => ({
    ...api.conversations.list.queryOptions({}),
    initialData: initialConversations,
  }));
  const conversations = conversationsQuery.data ?? initialConversations;

  const createConversation = useTRPCMutation((api) => api.conversations.create.mutationOptions());
  const deleteConversation = useTRPCMutation((api) => api.conversations.remove.mutationOptions());

  const select = (id: string | null) => {
    router.push(id === null ? '/dashboard/agent' : `/dashboard/agent?c=${id}`);
  };

  // New chat: create the thread, stash the first message, then navigate to it.
  const startNewChat = async (text: string) => {
    const conversation = await createConversation.mutateAsync({
      title: text.slice(0, TITLE_FROM_MESSAGE_LENGTH),
    });
    sessionStorage.setItem(pendingKey(conversation.id), text);
    await conversationsQuery.refetch();
    router.push(`/dashboard/agent?c=${conversation.id}`);
  };

  const removeConversation = async (id: string) => {
    await deleteConversation.mutateAsync({ id });
    await conversationsQuery.refetch();
    if (id === activeId) {
      select(null);
    }
  };

  return (
    <div className="flex h-full">
      <ThreadSidebar
        activeId={activeId}
        conversations={conversations}
        onDelete={removeConversation}
        onNewChat={() => {
          select(null);
        }}
        onSelect={select}
      />
      <div className="min-w-0 flex-1">
        <ChatThread
          key={activeId ?? 'new'}
          conversationId={activeId}
          initialMessages={initialMessages as UIMessage[]}
          pendingKey={pendingKey}
          onStartNewChat={startNewChat}
          onTurnComplete={() => conversationsQuery.refetch()}
        />
      </div>
    </div>
  );
};
