import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/server/require-admin';

import DeviceApproval from './_components/device-approval';

import type { Metadata, Route } from 'next';

export const metadata: Metadata = {
  title: 'Approve a device',
  robots: { index: false, follow: false },
};

/**
 * The human end of RFC 8628 device authorization: a device with no browser shows
 * a short code, and the person confirms it here under their own Helix session.
 *
 * The code is only ever a pointer to a pending request. Identity comes from the
 * session, never from the request, so approving somebody else's code still only
 * ever authorizes *you*.
 */
const DevicePage = async ({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string }>;
}): Promise<React.ReactElement> => {
  const [{ user_code: userCode }, user] = await Promise.all([
    searchParams,
    getSessionUser(await headers()),
  ]);

  if (user === null) {
    // Carry the code through the login round trip, so a user who followed the
    // device's complete verification URI does not have to retype it.
    const target =
      userCode === undefined ? '/device' : `/device?user_code=${encodeURIComponent(userCode)}`;
    redirect(`/auth/login?redirect=${encodeURIComponent(target)}` as Route);
  }

  return <DeviceApproval initialCode={userCode ?? ''} userEmail={user.email} />;
};

export default DevicePage;
