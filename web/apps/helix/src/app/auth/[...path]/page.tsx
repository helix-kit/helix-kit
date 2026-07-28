import { type ReactNode } from 'react';

import { Cpu } from 'lucide-react';

import { ForgotPasswordForm, LoginForm, RegisterForm, ResetPasswordForm } from './components';

const AuthComponents: {
  [key: string]: {
    Component: () => ReactNode;
    title: string;
    description: string;
  };
} = {
  login: {
    Component: LoginForm,
    title: 'Welcome back',
    description: 'Sign in to your workspace',
  },
  register: {
    Component: RegisterForm,
    title: 'Create your account',
    description: 'Get started with your email below',
  },
  'forgot-password': {
    Component: ForgotPasswordForm,
    title: 'Forgot password',
    description: 'Enter your email below to reset your password',
  },
  'reset-password': {
    Component: ResetPasswordForm,
    title: 'Reset password',
    description: 'Enter your new password below',
  },
};

const Brand = ({ className }: { className?: string }) => (
  <div className={`flex items-center gap-2 ${className ?? ''}`}>
    <Cpu className="text-primary size-6 shrink-0" />
    <span className="text-lg font-bold tracking-tight">
      HE<span className="text-primary">LIX</span>
    </span>
  </div>
);

// Faint grid texture for the brand panel.
const GRID_BACKGROUND = {
  backgroundImage:
    'linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px)',
  backgroundSize: '44px 44px',
};

export default async function Page(props: Readonly<PageProps<'/auth/[...path]'>>) {
  const { path } = await props.params;
  if (path.length === 0) {
    return null;
  }
  const AuthComponent = AuthComponents[path[0] ?? ''];
  if (AuthComponent === undefined) {
    return null;
  }
  return (
    <div className="bg-background flex min-h-svh">
      {/* ── Left brand panel (hidden on mobile) ── */}
      <aside className="border-border relative hidden w-1/2 flex-col justify-between overflow-hidden border-r p-12 lg:flex">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={GRID_BACKGROUND} />
        <Brand className="relative" />
        <div className="relative max-w-md space-y-5">
          <p className="text-primary text-xs font-semibold tracking-[0.2em] uppercase">
            IoT Management Platform
          </p>
          <h2 className="font-heading text-5xl leading-[1.05]">
            Manage every device.
            <br />
            <span className="text-primary">Ship with confidence.</span>
          </h2>
          <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">
            Provisioning, releases, and telemetry for fleets of embedded devices — one composable,
            open-source platform.
          </p>
        </div>
        <p className="text-muted-foreground/50 relative text-xs">
          © 2026 Helix — Open-source IoT platform
        </p>
      </aside>

      {/* ── Right form panel ── */}
      <main className="flex flex-1 items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-sm space-y-8">
          <Brand className="justify-center lg:hidden" />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{AuthComponent.title}</h1>
            <p className="text-muted-foreground text-sm">{AuthComponent.description}</p>
          </div>
          <AuthComponent.Component />
        </div>
      </main>
    </div>
  );
}
