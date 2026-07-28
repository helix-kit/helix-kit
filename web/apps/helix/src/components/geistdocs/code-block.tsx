'use client';

import {
  type CSSProperties,
  type HTMLAttributes,
  type JSX,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from 'react';

import { Button } from '@helix/design-system/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@helix/design-system/components/card';
import { cn } from '@helix/design-system/lib/utils';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { toast } from 'sonner';

interface CodeBlockProps extends HTMLAttributes<HTMLPreElement> {
  'data-line-highlighting'?: string;
  'data-line-numbers'?: string;
  icon?: ReactNode;
  style?: CSSProperties;
  tabIndex?: number;
  title?: string;
}

const COPY_RESET_DELAY_MS = 2000;

export const CodeBlock = (props: CodeBlockProps) => {
  const { children, className, icon, style, tabIndex, title, ...rest } = props;
  const ref = useRef<HTMLPreElement>(null);
  const [isCopied, setIsCopied] = useState(false);
  const { 'data-line-numbers': lineNumbers, ...preProps } = rest;
  const hasLineNumbers = typeof lineNumbers === 'string' && lineNumbers.length > 0;

  const copyToClipboard = useCallback(async () => {
    if (typeof window === 'undefined' || typeof navigator.clipboard.writeText !== 'function') {
      toast.error('Clipboard API not available');
      return;
    }

    const code = ref.current?.innerText;

    if (code === undefined || code.length === 0) {
      toast.error('No code to copy');
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setIsCopied(true);
      setTimeout(() => {
        setIsCopied(false);
      }, COPY_RESET_DELAY_MS);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      toast.error(message);
    }
  }, []);

  const Icon = isCopied ? CheckIcon : CopyIcon;

  const renderCodeBlock = useCallback(
    (preClassName?: string): JSX.Element => (
      <pre
        {...preProps}
        ref={ref}
        className={cn(
          'not-prose bg-background flex-1 overflow-x-auto rounded-sm border py-3 text-sm outline-none',
          '[&>code]:grid [&>code]:min-w-max',
          className,
          preClassName,
        )}
        style={style}
        tabIndex={tabIndex}
      >
        {children}
      </pre>
    ),
    [children, className, preProps, style, tabIndex],
  );

  if (title === undefined || title === '') {
    return (
      <div className="relative mb-6">
        {renderCodeBlock(hasLineNumbers ? 'line-numbers' : undefined)}
        <Button
          className="bg-background/80 absolute top-[5px] right-[5px] backdrop-blur-sm"
          size="icon"
          variant="ghost"
          onClick={copyToClipboard}
        >
          <Icon size={14} />
        </Button>
      </div>
    );
  }

  return (
    <Card className="not-prose mb-6 gap-0 overflow-hidden rounded-sm p-0 shadow-none">
      <CardHeader className="bg-sidebar text-muted-foreground flex items-center gap-2 border-b py-1.5! pr-1.5 pl-4">
        {icon === undefined ? null : <div className="flex size-3.5 shrink-0">{icon}</div>}
        <CardTitle className="flex-1 font-mono text-sm font-normal tracking-tight">
          {title}
        </CardTitle>
        <Button
          className={cn('shrink-0', className)}
          size="icon"
          variant="ghost"
          onClick={copyToClipboard}
        >
          <Icon size={14} />
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {renderCodeBlock(cn('rounded-none border-none', hasLineNumbers ? 'line-numbers' : ''))}
      </CardContent>
    </Card>
  );
};
