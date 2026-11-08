import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { ensureProfile } from '../profile_core';
import { MAX_PLAYERS, MODES, cleanAvatar, cleanName, ensureSweep, hex, leaveOthers, micros, newCode, pkey, startCountdown } from '../lobby_core';
import { DEFAULTS } from '../lobby_core';
import { START_NOW_S, WAIT_S, tally, waitSeconds } from '../rating_math';

// Quick play: no code, no host. A player asks to play and waits in the queue; as soon as a second player of the same
// mode is waiting, a lobby is made and a 30 s countdown starts, with a 'Start now' / 'Wait for more' vote. A late
// arrival joins the countdown while it is running. Rating and profiles are in profile_core.ts.

function addToLobby(ctx: any, lobby: number, who: any, name: string, avatar: string) {
  ctx.db.lobby_player.insert({ key: pkey(lobby, who), lobby_id: lobby, identity: who, name, avatar, ready: false, points: 0 });
}

export const quick_play = spacetimedb.reducer({ name: t.string(), avatar: t.string(), mode: t.string() }, (ctx, { name, avatar, mode }) => {
  if (!MODES.includes(mode)) throw new SenderError('mode must be market, battery, beat or pm');
  const who = cleanName(name);
  const face = cleanAvatar(avatar);
  // Already in a quick lobby that has not started: nothing to do.
  for (const p of ctx.db.lobby_player.identity.filter(ctx.sender)) {
    const l = ctx.db.lobby.id.find(p.lobby_id);
    if (l && l.kind === 'quick' && (l.state === 'countdown' || l.state === 'waiting')) return;
  }
  leaveOthers(ctx, null);
  ctx.db.quick_queue.identity.delete(ctx.sender);
  // Join a quick lobby of this mode whose countdown is still running.
  for (const l of ctx.db.lobby.iter()) {
    if (l.kind !== 'quick' || l.mode !== mode || l.state !== 'countdown') continue;
    if ([...ctx.db.lobby_player.lobby_id.filter(l.id)].length >= MAX_PLAYERS) continue;
    addToLobby(ctx, l.id, ctx.sender, who, face);
    return;
  }
  const waiting = [...ctx.db.quick_queue.iter()].filter((q: any) => q.mode === mode).sort((a: any, b: any) => Number(micros(a.joined_at) - micros(b.joined_at)));
  if (!waiting.length) {
    ctx.db.quick_queue.insert({ identity: ctx.sender, name: who, avatar: face, mode, joined_at: ctx.timestamp });
    return;
  }
  const group = waiting.slice(0, MAX_PLAYERS - 1);
  const l = ctx.db.lobby.insert({
    id: 0, code: newCode(ctx), host: group[0].identity, mode, state: 'waiting', kind: 'quick', countdown_s: 0, ...DEFAULTS,
    created_at: ctx.timestamp, state_since: ctx.timestamp, round_no: 0, countdown_until: ctx.timestamp,
  });
  for (const q of group) {
    // A queued player may have been in another lobby since; the queue entry wins.
    for (const old of [...ctx.db.lobby_player.identity.filter(q.identity)]) ctx.db.lobby_player.key.delete(old.key);
    addToLobby(ctx, l.id, q.identity, q.name, q.avatar);
    ctx.db.quick_queue.identity.delete(q.identity);
  }
  addToLobby(ctx, l.id, ctx.sender, who, face);
  ensureSweep(ctx);
  startCountdown(ctx, l, WAIT_S);
});

export const quick_cancel = spacetimedb.reducer({}, ctx => {
  ctx.db.quick_queue.identity.delete(ctx.sender);
});

// 'Start now' or 'Wait for more' during a quick lobby's countdown. Votes of players who have left do not count.
export const lobby_vote = spacetimedb.reducer({ vote: t.string() }, (ctx, { vote }) => {
  if (vote !== 'start' && vote !== 'wait') throw new SenderError('vote must be start or wait');
  let mine: any = null;
  for (const p of ctx.db.lobby_player.identity.filter(ctx.sender)) mine = p;
  const l = mine && ctx.db.lobby.id.find(mine.lobby_id);
  if (!l) throw new SenderError('you are not in a lobby');
  if (l.kind !== 'quick' || l.state !== 'countdown') throw new SenderError('voting is only open during a quick play countdown');
  const key = pkey(l.id, ctx.sender);
  const row = { key, lobby_id: l.id, identity: ctx.sender, vote };
  if (ctx.db.lobby_ballot.key.find(key)) ctx.db.lobby_ballot.key.update(row);
  else ctx.db.lobby_ballot.insert(row);
  const players = new Set([...ctx.db.lobby_player.lobby_id.filter(l.id)].map((p: any) => hex(p.identity)));
  const votes = [...ctx.db.lobby_ballot.lobby_id.filter(l.id)].filter((v: any) => players.has(hex(v.identity))).map((v: any) => v.vote);
  const outcome = tally(votes, players.size);
  if (outcome === 'start') startCountdown(ctx, l, START_NOW_S);
  else if (outcome === 'wait') {
    const seconds = waitSeconds(Number((micros(ctx.timestamp) - micros(l.created_at)) / 1_000_000n));
    if (!seconds) throw new SenderError('this lobby has already waited the maximum');
    startCountdown(ctx, l, seconds);
  }
});

// Set the name and avatar shown on the meta leaderboard (the profile itself is made at your first finished game).
export const profile_set = spacetimedb.reducer({ name: t.string(), avatar: t.string() }, (ctx, { name, avatar }) => {
  const who = cleanName(name);
  const face = cleanAvatar(avatar);
  const row = ensureProfile(ctx, ctx.sender, who, face, false);
  ctx.db.profile.identity.update({ ...row, name: who, avatar: face, updated_at: ctx.timestamp });
});
