import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/server/require-admin';

import EnrollmentApproval from './_components/enrollment-approval';

import type { Metadata, Route } from 'next';

export const metadata: Metadata = {
  title: 'Approve a persistent credential',
  robots: { index: false, follow: false },
};

/**
 * Where a device's request for a reusable credential is approved, and where the
 * credential itself is shown — once, and only to the account it belongs to.
 */
const EnrollDevicePage = async ({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string }>;
}): Promise<React.ReactElement> => {
  const [{ user_code: userCode }, user] = await Promise.all([
    searchParams,
    getSessionUser(await headers()),
  ]);

  if (user === null) {
    const target =
      userCode === undefined
        ? '/device/enroll'
        : `/device/enroll?user_code=${encodeURIComponent(userCode)}`;
    redirect(`/auth/login?redirect=${encodeURIComponent(target)}` as Route);
  }

  return <EnrollmentApproval initialCode={userCode ?? ''} userEmail={user.email} />;
};

export default EnrollDevicePage;
