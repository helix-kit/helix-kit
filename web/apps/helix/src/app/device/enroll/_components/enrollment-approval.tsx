'use client';

import { useState } from 'react';

import { Button } from '@helix-hq/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@helix-hq/design-system/components/card';
import { Input } from '@helix-hq/design-system/components/input';
import { Label } from '@helix-hq/design-system/components/label';
import { toast } from 'sonner';

import { useTRPCMutation, useTRPCQuery } from '@/server/react';

type Summary = Readonly<{ deviceId: string; username: string; durationHours: number }>;

const EnrollmentApproval = ({
  initialCode,
  userEmail,
}: {
  initialCode: string;
  userEmail: string;
}): React.ReactElement => {
  const [code, setCode] = useState(initialCode);
  const [confirmed, setConfirmed] = useState<string | null>(
    initialCode === '' ? null : initialCode,
  );
  const [credential, setCredential] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const summary = useTRPCQuery((api) => ({
    ...api.deviceEnrollment.summary.queryOptions({ userCode: confirmed ?? '' }),
    enabled: confirmed !== null,
    retry: false,
  }));

  const approve = useTRPCMutation((api) =>
    api.deviceEnrollment.approve.mutationOptions({
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  const deny = useTRPCMutation((api) =>
    api.deviceEnrollment.deny.mutationOptions({
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  const reveal = useTRPCMutation((api) =>
    api.deviceEnrollment.reveal.mutationOptions({
      onSuccess: (result) => {
        setCredential(result.credential);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  if (credential !== null) {
    return (
      <Card className="mx-auto mt-16 max-w-xl">
        <CardHeader>
          <CardTitle>Copy this now</CardTitle>
          <CardDescription>
            This credential will not be shown again. Return to your terminal and paste it there to
            activate it — until you do, it does nothing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <code className="bg-muted block rounded-md px-4 py-3 font-mono text-sm break-all">
            {credential}
          </code>
        </CardContent>
        <CardFooter>
          <Button
            onClick={() => {
              navigator.clipboard
                .writeText(credential)
                .then(() => {
                  setCopied(true);
                  return undefined;
                })
                .catch(() => {
                  // Clipboard access is often refused; the credential is on screen
                  // either way, which is why it is shown and not only copied.
                  toast.error('Could not copy. Select it and copy it by hand.');
                });
            }}
          >
            {copied ? 'Copied' : 'Copy credential'}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (confirmed === null || summary.data === undefined) {
    return (
      <Card className="mx-auto mt-16 max-w-md">
        <CardHeader>
          <CardTitle>Approve a persistent credential</CardTitle>
          <CardDescription>
            A device is asking to create a reusable credential for{' '}
            <span className="font-medium">{userEmail}</span>. Enter the code it is showing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="user-code">Code from the device</Label>
          <Input
            autoCapitalize="characters"
            autoComplete="off"
            className="font-mono tracking-[0.3em] uppercase"
            id="user-code"
            placeholder="XXXXXXXX"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
            }}
          />
          {summary.isError ? (
            <p className="text-destructive text-sm">
              That enrollment could not be found. It may have expired.
            </p>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button
            disabled={code.trim() === ''}
            onClick={() => {
              setConfirmed(code.trim().toUpperCase());
            }}
          >
            Continue
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const details: Summary = summary.data;

  return (
    <Card className="mx-auto mt-16 max-w-md">
      <CardHeader>
        <CardTitle>Approve a persistent credential</CardTitle>
        <CardDescription>
          Device <span className="font-medium">{details.deviceId}</span> is asking for a credential
          for <span className="font-medium">{details.username}</span>, valid for{' '}
          <span className="font-medium">{details.durationHours} hours</span>. It will carry your
          access, and every use of it is checked against Helix.
        </CardDescription>
      </CardHeader>
      <CardFooter className="gap-2">
        <Button
          disabled={approve.isPending || reveal.isPending || deny.isPending}
          onClick={() => {
            approve
              .mutateAsync({ userCode: confirmed })
              .then(() => reveal.mutateAsync({ userCode: confirmed }))
              .catch(() => {
                // Both mutations report their own failures through a toast.
              });
          }}
        >
          Approve and reveal
        </Button>
        <Button
          disabled={approve.isPending || reveal.isPending || deny.isPending}
          variant="outline"
          onClick={() => {
            // Refusing destroys the pending credential rather than leaving it to
            // sit until it expires.
            deny.mutate({ userCode: confirmed });
            approve.reset();
            setConfirmed(null);
            toast.success('Enrollment refused.');
          }}
        >
          Refuse
        </Button>
      </CardFooter>
    </Card>
  );
};

export default EnrollmentApproval;
