'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// GFM markdown for assistant messages, styled by the Tailwind typography plugin
// (loaded in globals.css). `prose-sm` fits the chat density; `dark:prose-invert`
// tracks the theme.
export const ChatMarkdown = ({ children }: { children: string }) => (
  <div className="prose prose-sm dark:prose-invert prose-code:before:content-none prose-code:after:content-none max-w-none break-words">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
  </div>
);
