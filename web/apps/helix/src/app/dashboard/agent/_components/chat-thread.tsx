'use client';

import { useEffect, useRef, useState } from 'react';

import { useChat } from '@ai-sdk/react';
import { Button } from '@helix/design-system/components/button';
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from 'ai';
import { ArrowUp, Bot, User } from 'lucide-react';

import { ChatMarkdown } from './chat-markdown';
import { ToolCard } from './tool-card';

type ChatThreadProps = {
  conversationId: string | null;
  initialMessages: UIMessage[];
  onStartNewChat: (text: string) => void;
  onTurnComplete: () => void;
  pendingKey: (id: string) => string;
};

export const ChatThread = ({
  conversationId,
  initialMessages,
  onStartNewChat,
  onTurnComplete,
  pendingKey,
}: ChatThreadProps) => {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error } = useChat({
    id: conversationId ?? 'new',
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: '/api/agent/chat' }),
    onFinish: () => {
      onTurnComplete();
    },
  });

  const streaming = status === 'submitted' || status === 'streaming';

  // Hand-off: a freshly created thread auto-sends the message typed in the new-chat composer.
  useEffect(() => {
    if (conversationId === null) {
      return;
    }
    const pending = sessionStorage.getItem(pendingKey(conversationId));
    if (pending !== null) {
      sessionStorage.removeItem(pendingKey(conversationId));
      void sendMessage({ text: pending });
    }
    // Only on mount for this thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (text === '' || streaming) {
      return;
    }
    setInput('');
    if (conversationId === null) {
      onStartNewChat(text);
      return;
    }
    void sendMessage({ text });
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 p-6">
          {messages.length === 0 ? (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 py-24 text-center">
              <Bot className="size-8" />
              <p className="text-sm">
                Ask the Helix assistant anything — it can read and act across the platform.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className="flex gap-3">
                <div className="text-muted-foreground mt-0.5 shrink-0">
                  {message.role === 'user' ? (
                    <User className="size-5" />
                  ) : (
                    <Bot className="size-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {message.parts.map((part, index) => {
                    const partKey = `${message.id}-${index}`;
                    if (part.type === 'text') {
                      return message.role === 'user' ? (
                        <p key={partKey} className="text-sm whitespace-pre-wrap">
                          {part.text}
                        </p>
                      ) : (
                        <ChatMarkdown key={partKey}>{part.text}</ChatMarkdown>
                      );
                    }
                    if (part.type === 'reasoning') {
                      return part.text.trim() === '' ? null : (
                        <p
                          key={partKey}
                          className="text-muted-foreground border-l-2 pl-3 text-xs whitespace-pre-wrap italic"
                        >
                          {part.text}
                        </p>
                      );
                    }
                    if (isToolUIPart(part)) {
                      return <ToolCard key={partKey} name={getToolName(part)} part={part} />;
                    }
                    return null;
                  })}
                </div>
              </div>
            ))
          )}
          {error !== undefined ? (
            <p className="text-destructive text-sm">Error: {error.message}</p>
          ) : null}
        </div>
      </div>

      <form className="border-t p-4" onSubmit={submit}>
        <div className="bg-background focus-within:ring-ring mx-auto flex max-w-3xl items-end gap-2 rounded-lg border p-2 focus-within:ring-1">
          <textarea
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
            placeholder="Message the Helix assistant…"
            rows={1}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                submit(event);
              }
            }}
          />
          <Button disabled={streaming || input.trim() === ''} size="icon" type="submit">
            <ArrowUp />
          </Button>
        </div>
      </form>
    </div>
  );
};
