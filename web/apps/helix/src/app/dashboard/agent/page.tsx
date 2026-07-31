import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { TRPCReactProvider } from '@/server/react';
import { getSessionUser } from '@/server/require-admin';
import { fetchQuery } from '@/server/server';

import { AgentApp } from './_components/agent-app';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Assistant',
  robots: { index: false, follow: false },
};

export default async function AgentPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ c?: string }>;
}>) {
  const user = await getSessionUser(await headers());
  if (user === null) {
    redirect('/auth/login?redirect=/dashboard/agent');
  }

  const { c } = await searchParams;
  const conversations = await fetchQuery((trpc) => trpc.agent.listConversations.queryOptions());

  let activeId: string | null = null;
  let initialMessages: unknown[] = [];
  if (c != null && c !== '') {
    try {
      const conversation = await fetchQuery((trpc) =>
        trpc.agent.getConversation.queryOptions({ id: c }),
      );
      activeId = conversation.id;
      initialMessages = conversation.messages;
    } catch {
      // Unknown or not-owned thread: fall back to a new chat.
      activeId = null;
    }
  }

  return (
    <div className="h-full">
      <TRPCReactProvider>
        <AgentApp
          activeId={activeId}
          initialConversations={conversations}
          initialMessages={initialMessages}
        />
      </TRPCReactProvider>
    </div>
  );
}
