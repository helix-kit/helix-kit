import { cookies } from 'next/headers';

import setCookieParser from 'set-cookie-parser';

export const setCookieHeader = async (key: string, value: string, resHeaders: Headers) => {
  if (key.toLowerCase() === 'set-cookie') {
    const cookieObjects = setCookieParser.parseSetCookie(value, { split: true });
    const cookieStore = await cookies();
    for (const c of cookieObjects) {
      cookieStore.set({
        name: c.name,
        value: c.value,
        httpOnly: c.httpOnly,
        secure: c.secure,
        path: c.path,
        expires: c.expires,
        sameSite: c.sameSite as 'lax' | 'strict' | 'none' | undefined,
      });
    }
  } else {
    resHeaders.set(key, value);
  }
};
