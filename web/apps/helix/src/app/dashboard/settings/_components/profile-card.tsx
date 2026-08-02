'use client';

import { useState } from 'react';

import { Button } from '@helix/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@helix/design-system/components/card';
import { Input } from '@helix/design-system/components/input';
import { Label } from '@helix/design-system/components/label';
import { toast } from 'sonner';

import { authClient } from '@/lib/auth-client';

export const ProfileCard = ({ name, email }: { name: string; email: string }) => {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const result = await authClient.updateUser({ name: value.trim() });
    setBusy(false);
    if (result.error != null) {
      toast.error(result.error.message ?? 'Failed to update profile');
      return;
    }
    toast.success('Profile updated');
  };

  const unchanged = value.trim() === '' || value.trim() === name;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your account details.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="settings-name">Name</Label>
          <Input
            id="settings-name"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="settings-email">Email</Label>
          <Input disabled id="settings-email" value={email} />
        </div>
      </CardContent>
      <CardFooter>
        <Button disabled={busy || unchanged} onClick={save}>
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
      </CardFooter>
    </Card>
  );
};
