'use client';

import { Button } from '@helix/design-system/components/button';
import { DeleteConfirmDialog } from '@helix/design-system/components/delete-confirm-dialog';
import { cn } from '@helix/design-system/lib/utils';
import { MessageSquarePlus, Trash2 } from 'lucide-react';

import type { Conversations } from './agent-app';

type ThreadSidebarProps = {
  conversations: Conversations;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => Promise<void>;
};

export const ThreadSidebar = ({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onDelete,
}: ThreadSidebarProps) => (
  <div className="bg-muted/30 flex h-full w-64 shrink-0 flex-col border-r">
    <div className="p-3">
      <Button className="w-full justify-start" size="sm" variant="outline" onClick={onNewChat}>
        <MessageSquarePlus />
        New chat
      </Button>
    </div>
    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
      {conversations.length === 0 ? (
        <p className="text-muted-foreground px-2 py-4 text-center text-xs">No conversations yet.</p>
      ) : (
        conversations.map((conversation) => (
          <div
            key={conversation.id}
            className={cn(
              'group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm',
              conversation.id === activeId ? 'bg-accent' : 'hover:bg-accent/50',
            )}
          >
            <button
              className="min-w-0 flex-1 truncate text-left"
              type="button"
              onClick={() => {
                onSelect(conversation.id);
              }}
            >
              {conversation.title.trim() === '' ? 'New chat' : conversation.title}
            </button>
            <DeleteConfirmDialog
              description="This permanently deletes the conversation and its tool-call history."
              title="Delete conversation?"
              trigger={
                <Button
                  className="size-6 shrink-0 opacity-0 group-hover:opacity-100"
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              }
              onConfirm={() => onDelete(conversation.id)}
            />
          </div>
        ))
      )}
    </div>
  </div>
);
