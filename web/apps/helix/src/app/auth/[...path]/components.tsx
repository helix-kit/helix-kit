'use client';

import { useCallback, useEffect, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@helix/design-system/components/button';
import { Checkbox } from '@helix/design-system/components/checkbox';
import { Input } from '@helix/design-system/components/input';
import { Label } from '@helix/design-system/components/label';
import { Separator } from '@helix/design-system/components/separator';
import { Fingerprint } from 'lucide-react';
import { useQueryStates, parseAsString } from 'nuqs';
import { toast } from 'sonner';

import { authClient, signIn, signUp } from '@/lib/auth-client';

import type { Route } from 'next';

export const LoginForm = () => {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [searchParams] = useQueryStates({
    redirect: parseAsString.withDefault('/'),
  });
  const router = useRouter();

  const signInUsingPasskey = useCallback(
    async (opts?: { autoFill?: boolean }) => {
      await authClient.signIn.passkey(opts, {
        onSuccess: () => {
          router.push(searchParams.redirect as Route);
        },
        onError: (ctx) => {
          toast.error(ctx.error.message);
        },
      });
    },
    [searchParams.redirect, router],
  );

  useEffect(() => {
    const check = async () => {
      if (typeof window === 'undefined' || 'PublicKeyCredential' in window === false) {
        return;
      }
      const conditionalMediaAvailable = await PublicKeyCredential.isConditionalMediationAvailable();
      if (conditionalMediaAvailable) {
        setPasskeyAvailable(true);
        void signInUsingPasskey({ autoFill: true });
      }
    };
    void check();
  }, [signInUsingPasskey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await signIn.email(
      {
        email,
        password,
        rememberMe: remember,
        callbackURL: searchParams.redirect,
      },
      {
        onResponse: () => {
          setLoading(false);
        },
        onError: (ctx) => {
          toast.error(ctx.error.message);
        },
      },
    );
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          autoComplete="email username webauthn"
          id="email"
          placeholder="you@company.com"
          required
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center">
          <Label htmlFor="password">Password</Label>
          <Link
            className="text-muted-foreground ml-auto text-sm underline-offset-4 hover:underline"
            href={`/auth/forgot-password?redirect=${searchParams.redirect}`}
          >
            Forgot password?
          </Link>
        </div>
        <Input
          autoComplete="current-password webauthn"
          id="password"
          placeholder="Password"
          required
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          checked={remember}
          id="remember"
          onCheckedChange={(checked) => {
            setRemember(checked === true);
          }}
        />
        <Label className="text-sm font-normal" htmlFor="remember">
          Remember me
        </Label>
      </div>
      <Button disabled={loading} type="submit">
        Sign in
      </Button>

      <div className="relative flex items-center py-2">
        <Separator className="flex-1" />
        <span className="text-muted-foreground bg-card px-3 text-xs">Or continue with</span>
        <Separator className="flex-1" />
      </div>

      <Button
        disabled={!passkeyAvailable}
        type="button"
        variant="outline"
        onClick={() => {
          void signInUsingPasskey();
        }}
      >
        <Fingerprint className="size-4" />
        Login with Passkey
      </Button>

      <p className="text-muted-foreground text-center text-sm">
        Don&apos;t have an account?{' '}
        <Link
          className="underline underline-offset-4"
          href={`/auth/register?redirect=${searchParams.redirect}`}
        >
          Sign up
        </Link>
      </p>
    </form>
  );
};

export const RegisterForm = () => {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [searchParams] = useQueryStates({
    redirect: parseAsString.withDefault('/'),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await signUp.email(
      {
        email,
        password,
        name,
        callbackURL: searchParams.redirect,
      },
      {
        onResponse: () => {
          setLoading(false);
        },
        onError: (ctx) => {
          toast.error(ctx.error.message);
        },
      },
    );
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Full name</Label>
        <Input
          id="name"
          placeholder="John Doe"
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          placeholder="name@example.com"
          required
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          placeholder="Password"
          required
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
      </div>
      <Button disabled={loading} type="submit">
        Register
      </Button>
      <p className="text-muted-foreground text-center text-sm">
        Already have an account?{' '}
        <Link
          className="underline underline-offset-4"
          href={`/auth/login?redirect=${searchParams.redirect}`}
        >
          Login
        </Link>
      </p>
    </form>
  );
};

export const ForgotPasswordForm = () => {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [searchParams] = useQueryStates({
    redirect: parseAsString.withDefault('/'),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await authClient.requestPasswordReset(
      {
        email,
        redirectTo: `/auth/reset-password?redirect=${searchParams.redirect}`,
      },
      {
        onResponse: () => {
          setLoading(false);
        },
        onError: (ctx) => {
          toast.error(ctx.error.message);
        },
        onSuccess: () => {
          toast.success('Check your email for password reset link');
        },
      },
    );
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          placeholder="name@example.com"
          required
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
      </div>
      <Button disabled={loading} type="submit">
        Send reset link
      </Button>
      <p className="text-muted-foreground text-center text-sm">
        <Link className="underline underline-offset-4" href="/auth/login">
          Back to login
        </Link>
      </p>
    </form>
  );
};

export const ResetPasswordForm = () => {
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState('');
  const [searchParams] = useQueryStates({
    redirect: parseAsString.withDefault('/'),
    token: parseAsString,
    error: parseAsString,
  });
  const router = useRouter();

  if (searchParams.token === null || searchParams.error !== null) {
    return (
      <div className="text-center">
        <p className="text-destructive">Invalid or expired reset link</p>
        <Link className="text-sm underline underline-offset-4" href="/auth/forgot-password">
          Request a new one
        </Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await authClient.resetPassword(
      {
        newPassword: password,
        token: searchParams.token ?? '',
      },
      {
        onResponse: () => {
          setLoading(false);
        },
        onError: (ctx) => {
          toast.error(ctx.error.message);
        },
        onSuccess: () => {
          toast.success('Password reset successfully');
          router.push(searchParams.redirect as Route);
        },
      },
    );
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          placeholder="New password"
          required
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
      </div>
      <Button disabled={loading} type="submit">
        Reset password
      </Button>
    </form>
  );
};
