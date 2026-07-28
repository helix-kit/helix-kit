import { createHmac } from 'node:crypto';

import { createRouterFactory, TRPCError } from '../trpc';

const MS_PER_SECOND = 1000;

export type IceSessionUser = Readonly<{ id: string }>;

export type TurnSettings = Readonly<{
  // Comma-separated TURN URLs (udp/tcp/tls variants of the same relay).
  serverUrls: readonly string[];
  // Shared secret, also configured as coturn's static-auth-secret.
  staticAuthSecret: string;
  // Seconds a minted credential stays valid.
  ttlSeconds: number;
}>;

export type IceContext = Readonly<{
  user: IceSessionUser | null;
  stunUrls: readonly string[];
  // Null when TURN is not deployed — STUN-only is a valid configuration, and
  // direct peers still connect.
  turn: TurnSettings | null;
}>;

export type IceServer = Readonly<{
  urls: readonly string[];
  username?: string;
  credential?: string;
}>;

// coturn REST credentials: username carries its own expiry, password is the HMAC
// over it. See https://datatracker.ietf.org/doc/html/draft-uberti-behave-turn-rest
export const mintTurnCredential = (
  userId: string,
  turn: TurnSettings,
  nowSeconds: number,
): { username: string; credential: string } => {
  const username = `${nowSeconds + turn.ttlSeconds}:${userId}`;
  const credential = createHmac('sha1', turn.staticAuthSecret).update(username).digest('base64');
  return { username, credential };
};

export const iceRouter = createRouterFactory<IceContext>()((t) => {
  const authedProcedure = t.procedure.use(({ ctx, next }) => {
    if (ctx.user === null) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in to use the P2P data plane' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });

  return t.router({
    config: authedProcedure.query(({ ctx }) => {
      const iceServers: IceServer[] = [];
      if (ctx.stunUrls.length > 0) {
        iceServers.push({ urls: [...ctx.stunUrls] });
      }
      if (ctx.turn !== null && ctx.turn.serverUrls.length > 0) {
        const { username, credential } = mintTurnCredential(
          ctx.user.id,
          ctx.turn,
          Math.floor(Date.now() / MS_PER_SECOND),
        );
        iceServers.push({ urls: [...ctx.turn.serverUrls], username, credential });
      }
      return {
        iceServers,
        ttlSeconds: ctx.turn?.ttlSeconds ?? 0,
      };
    }),
  });
});
