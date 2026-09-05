import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/server/require-admin';

import OfflineResponder from './_components/offline-responder';

import type { Metadata, Route } from 'next';

export const metadata: Metadata = {
  title: 'Offline device sign-in',
  robots: { index: false, follow: false },
};

/**
 * The phone half of offline device authentication.
 *
 * Someone is standing at a device that cannot reach the cloud. They read a
 * challenge off its screen, submit it here, and type the answer back.
 *
 * The form asks for the device and the challenge and nothing else: who you are
 * comes from this session. Submitting a challenge you found on somebody else's
 * screen gets you a response bound to *you*, which their device will refuse.
 */
const OfflineDevicePage = async (): Promise<React.ReactElement> => {
  const user = await getSessionUser(await headers());
  if (user === null) {
    redirect(`/auth/login?redirect=${encodeURIComponent('/device/offline')}` as Route);
  }

  return <OfflineResponder userEmail={user.email} />;
};

export default OfflineDevicePage;
