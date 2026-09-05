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

import { useTRPCMutation } from '@/server/react';

/** Codes are shown hyphenated for reading; the server wants them plain. */
const normalize = (value: string): string =>
  value.trim().toUpperCase().replaceAll('-', '').replaceAll(' ', '');

const CODE_LENGTH = 8;
const CODE_GROUP = 4;

/** Renders an eight-character code the way the device displays it. */
const forReading = (code: string): string =>
  code.length === CODE_LENGTH ? `${code.slice(0, CODE_GROUP)}-${code.slice(CODE_GROUP)}` : code;

const OfflineResponder = ({ userEmail }: { userEmail: string }): React.ReactElement => {
  const [deviceId, setDeviceId] = useState('');
  const [challenge, setChallenge] = useState('');
  const [response, setResponse] = useState<string | null>(null);

  const respond = useTRPCMutation((api) =>
    api.offlineAuth.respond.mutationOptions({
      onSuccess: (result) => {
        setResponse(result.response);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  if (response !== null) {
    return (
      <Card className="mx-auto mt-16 max-w-md">
        <CardHeader>
          <CardTitle>Type this back into the device</CardTitle>
          <CardDescription>
            It works once, on that device, for you alone. It grants nothing on its own — the device
            still applies whatever access you already had.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <code className="bg-muted block rounded-md px-4 py-3 text-center font-mono text-2xl tracking-[0.3em]">
            {forReading(response)}
          </code>
        </CardContent>
        <CardFooter>
          <Button
            variant="outline"
            onClick={() => {
              setResponse(null);
              setChallenge('');
            }}
          >
            Answer another challenge
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="mx-auto mt-16 max-w-md">
      <CardHeader>
        <CardTitle>Offline device sign-in</CardTitle>
        <CardDescription>
          For a device that cannot reach Helix. Enter what it is showing and you will get a response
          to type back. You are signed in as <span className="font-medium">{userEmail}</span>, and
          the response will only work for that account.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="device-id">Device</Label>
          <Input
            autoComplete="off"
            disabled={respond.isPending}
            id="device-id"
            placeholder="D123"
            value={deviceId}
            onChange={(event) => {
              setDeviceId(event.target.value);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="challenge">Challenge</Label>
          <Input
            autoCapitalize="characters"
            autoComplete="off"
            className="font-mono tracking-[0.3em] uppercase"
            disabled={respond.isPending}
            id="challenge"
            placeholder="XXXX-XXXX"
            value={challenge}
            onChange={(event) => {
              setChallenge(event.target.value);
            }}
          />
        </div>
      </CardContent>

      <CardFooter>
        <Button
          disabled={respond.isPending}
          onClick={() => {
            respond.mutate({
              deviceId: deviceId.trim(),
              challenge: normalize(challenge),
            });
          }}
        >
          Get response
        </Button>
      </CardFooter>
    </Card>
  );
};

export default OfflineResponder;
