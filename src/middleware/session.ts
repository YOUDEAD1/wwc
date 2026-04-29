import { session, type Context, type SessionFlavor } from 'grammy';

export type SessionData = {
  /** Selected qty per product id, used by the shop product page */
  qty: Record<number, number>;
};

export type SessionCtx = Context & SessionFlavor<SessionData>;

export const sessionMiddleware = session<SessionData, SessionCtx>({
  initial: (): SessionData => ({ qty: {} }),
});
