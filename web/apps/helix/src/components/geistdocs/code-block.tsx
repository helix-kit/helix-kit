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

import { Button } from '@helix-hq/design-system/components/button';
import { cn } from '@helix-hq/design-system/lib/utils';
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

  const copyButton = (floating: boolean): JSX.Element => (
    <Button
      aria-label="Copy code"
      className={cn(
        'text-muted-foreground hover:text-foreground size-7 shrink-0',
        floating &&
          'bg-background/60 absolute top-2.5 right-2.5 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
      )}
      size="icon"
      variant="ghost"
      onClick={copyToClipboard}
    >
      <Icon size={14} />
    </Button>
  );

  const codePre = (
    <pre
      {...preProps}
      ref={ref}
      className={cn(
        'not-prose blog-code-scroll m-0 overflow-x-auto bg-transparent px-4 py-4 text-[13px] leading-relaxed outline-none',
        '[&>code]:grid [&>code]:min-w-max',
        hasLineNumbers && 'line-numbers',
        className,
      )}
      style={style}
      tabIndex={tabIndex}
    >
      {children}
    </pre>
  );

  return (
    <div className="not-prose group border-border/70 bg-muted/40 relative my-6 overflow-hidden rounded-xl border shadow-sm">
      {title === undefined || title === '' ? (
        <>
          {codePre}
          {copyButton(true)}
        </>
      ) : (
        <>
          <div className="border-border/60 bg-muted/60 text-muted-foreground flex items-center gap-2 border-b py-2.5 pr-2 pl-4">
            {icon === undefined ? null : <div className="flex size-3.5 shrink-0">{icon}</div>}
            <span className="flex-1 font-mono text-xs tracking-tight">{title}</span>
            {copyButton(false)}
          </div>
          {codePre}
        </>
      )}
    </div>
  );
};
