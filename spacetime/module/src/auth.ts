import { t, SenderError } from 'spacetimedb/server';
import { Identity } from 'spacetimedb';
import spacetimedb from './schema';

// The CLI identity that owns the live living-grid database. `init` only runs on a fresh publish, so a
// migrate of the already-running database would leave the admin table empty; this keeps the owner
// (and the engine publisher, which sends the owner token) authorised either way. Public, not a secret.
export const BOOTSTRAP_ADMINS = ['c200269bf52005ec1903c42c87e38048947cc3ee94ebe5afa3c9e767100984c6'];

type Ctx = { sender: Identity; db: any };

export function isAdmin(ctx: Ctx): boolean {
  const hex = ctx.sender.toHexString();
  return BOOTSTRAP_ADMINS.includes(hex) || !!ctx.db.admin.identity.find(ctx.sender);
}

export function requireAdmin(ctx: Ctx): void {
  if (!isAdmin(ctx)) throw new SenderError('not authorised: publish reducers only accept the publisher identity');
}

export const init = spacetimedb.init(ctx => {
  if (!ctx.db.admin.identity.find(ctx.sender)) {
    ctx.db.admin.insert({ identity: ctx.sender, note: 'module publisher', added_at: ctx.timestamp });
  }
});

export const add_admin = spacetimedb.reducer({ identity_hex: t.string(), note: t.string() }, (ctx, { identity_hex, note }) => {
  requireAdmin(ctx);
  const identity = Identity.fromString(identity_hex);
  if (!ctx.db.admin.identity.find(identity)) ctx.db.admin.insert({ identity, note, added_at: ctx.timestamp });
});

export const remove_admin = spacetimedb.reducer({ identity_hex: t.string() }, (ctx, { identity_hex }) => {
  requireAdmin(ctx);
  ctx.db.admin.identity.delete(Identity.fromString(identity_hex));
});
