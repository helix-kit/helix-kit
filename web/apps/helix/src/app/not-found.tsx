import Link from 'next/link';

import { Button } from '@helix-hq/design-system/components/button';

import { Logo } from '@/components/logo';

const NotFound = () => (
  <div className="grid min-h-svh place-items-center px-4">
    <div className="grid max-w-md gap-6 text-center">
      <div className="flex justify-center">
        <Logo />
      </div>
      <div className="grid gap-2">
        <p className="text-brand text-5xl font-semibold tracking-tight">404</p>
        <h1 className="text-xl font-medium">Page not found</h1>
        <p className="text-muted-foreground text-sm">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
      </div>
      <div className="flex justify-center gap-3">
        <Button asChild>
          <Link href="/">Back home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/docs">Read the docs</Link>
        </Button>
      </div>
    </div>
  </div>
);

export default NotFound;
