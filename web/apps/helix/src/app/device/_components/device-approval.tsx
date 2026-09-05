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

import { authClient } from '@/lib/auth-client';

type Outcome = 'approved' | 'denied';

/** Codes are shown to humans as XXXX-XXXX; the server wants them unpunctuated. */
const normalizeCode = (value: string): string => value.trim().toUpperCase().replaceAll('-', '');

const DeviceApproval = ({
  initialCode,
  userEmail,
}: {
  initialCode: string;
  userEmail: string;
}): React.ReactElement => {
  const [code, setCode] = useState(initialCode);
  const [pending, setPending] = useState(false);
  const [claimed, setClaimed] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  /**
   * Surfaces whichever description the failure carries. The plugin's endpoints
   * return OAuth-shaped errors (`error_description`) while the generic fetch
   * helper returns Better Auth's own (`message`), so both are checked.
   */
  const report = (error: unknown): void => {
    const body = error as { error_description?: unknown; message?: unknown };
    const description = [body.error_description, body.message].find(
      (value): value is string => typeof value === 'string' && value !== '',
    );
    toast.error(description ?? 'That code could not be used. It may have expired.');
  };

  /**
   * Claims the pending request for this session before anything can be decided.
   * The server refuses approve/deny until a signed-in session has looked the code
   * up, which is what ties the decision to a specific person.
   */
  const claim = async (): Promise<void> => {
    const userCode = normalizeCode(code);
    if (userCode === '') {
      toast.error('Enter the code shown on the device.');
      return;
    }

    setPending(true);
    const result = await authClient.$fetch<{ user_code: string; status: string }>(
      `/device?user_code=${encodeURIComponent(userCode)}`,
      { method: 'GET' },
    );
    setPending(false);

    if (result.error !== null) {
      report(result.error);
      return;
    }
    setClaimed(userCode);
  };

  const decide = async (decision: Outcome): Promise<void> => {
    if (claimed === null) return;

    setPending(true);
    const result =
      decision === 'approved'
        ? await authClient.device.approve({ userCode: claimed })
        : await authClient.device.deny({ userCode: claimed });
    setPending(false);

    if (result.error !== null) {
      report(result.error);
      return;
    }
    setOutcome(decision);
  };

  if (outcome !== null) {
    return (
      <Card className="mx-auto mt-16 max-w-md">
        <CardHeader>
          <CardTitle>{outcome === 'approved' ? 'Device approved' : 'Request denied'}</CardTitle>
          <CardDescription>
            {outcome === 'approved'
              ? 'Return to the device: it should continue on its own.'
              : 'Nothing was granted. You can close this page.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="mx-auto mt-16 max-w-md">
      <CardHeader>
        <CardTitle>Approve a device</CardTitle>
        <CardDescription>
          {claimed === null ? (
            <>
              A device is asking to sign in. Continue only if you started this, and only if the code
              below matches the one shown on the device.
            </>
          ) : (
            <>
              Approving signs the device in as <span className="font-medium">{userEmail}</span>. It
              will have your access, not its own.
            </>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-2">
        <Label htmlFor="user-code">Code from the device</Label>
        <Input
          autoCapitalize="characters"
          autoComplete="off"
          className="font-mono tracking-[0.3em] uppercase"
          disabled={pending || claimed !== null}
          id="user-code"
          placeholder="XXXX-XXXX"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
          }}
        />
      </CardContent>

      <CardFooter className="gap-2">
        {claimed === null ? (
          <Button
            disabled={pending}
            onClick={() => {
              void claim();
            }}
          >
            Continue
          </Button>
        ) : (
          <>
            <Button
              disabled={pending}
              onClick={() => {
                void decide('approved');
              }}
            >
              Approve
            </Button>
            <Button
              disabled={pending}
              variant="outline"
              onClick={() => {
                void decide('denied');
              }}
            >
              Deny
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
};

export default DeviceApproval;
