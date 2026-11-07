import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { acctKey } from '../market_core';
import { clue_purchase } from '../tables';

// Clue shop. During a round a player can spend points to see what the model sees for one question: the wind forecast,
// temperature against normal, the gas move, the demand forecast, interconnector flows, and what our model says and why.
// The catalogue is precomputed per day (engine/market/clues.py) into market_day_pool.clues_json:
//   { "<question id>": [ { id, label, cost, body } ] }   question id as in the pool, without the lobby prefix.
// The pool and the day are private. What is for sale (label and cost only) reaches a player through my_clue_offers;
// what they bought (with the text) through my_clues. Bots never buy: only a joined, non-model account can.

type Clue = { id: string; label: string; cost: number; body: string };

function catalogue(ctx: any, lobby: number): Record<string, Clue[]> {
  const day = ctx.db.market_secret.round.find(lobby)?.day;
  const pooled = day ? ctx.db.market_day_pool.day.find(day) : null;
  if (!pooled || !pooled.clues_json) return {};
  try {
    return JSON.parse(pooled.clues_json);
  } catch {
    return {};
  }
}

const rawId = (lobby: number, qid: string) => (qid.startsWith(`${lobby}|`) ? qid.slice(String(lobby).length + 1) : qid);

export const clue_buy = spacetimedb.reducer({ question_id: t.string(), clue_id: t.string() }, (ctx, { question_id, clue_id }) => {
  const q = ctx.db.market_question.id.find(question_id);
  if (!q) throw new SenderError(`unknown question ${question_id}`);
  const r = ctx.db.market_round.id.find(q.lobby_id);
  if (!r || r.status !== 'running') throw new SenderError('no market round is running in this lobby');
  if (q.status !== 'open' || r.clock_hour >= q.target_hour) throw new SenderError('that question has closed');
  const acct = ctx.db.market_account.key.find(acctKey(q.lobby_id, ctx.sender));
  if (!acct || acct.is_model) throw new SenderError('join this lobby first');
  const clue = (catalogue(ctx, q.lobby_id)[rawId(q.lobby_id, question_id)] ?? []).find(c => c.id === clue_id);
  if (!clue) throw new SenderError(`no clue ${clue_id} for this question`);
  const key = `${question_id}|${ctx.sender.toHexString()}|${clue_id}`;
  if (ctx.db.clue_purchase.key.find(key)) throw new SenderError('you already bought that clue');
  if (!(clue.cost >= 0) || clue.cost > acct.points + 1e-9) throw new SenderError('not enough points');
  ctx.db.market_account.key.update({ ...acct, points: acct.points - clue.cost });
  ctx.db.clue_purchase.insert({
    key, lobby_id: q.lobby_id, identity: ctx.sender, question_id, clue_id, label: clue.label, body: clue.body, cost: clue.cost,
    bought_hour: r.clock_hour,
  });
});

const Offer = t.row('ClueOffer', { question_id: t.string(), clue_id: t.string(), label: t.string(), cost: t.f64(), bought: t.bool() });

// What is on sale in the caller's lobbies, without the text.
export const my_clue_offers = spacetimedb.view({ name: 'my_clue_offers', public: true }, t.array(Offer), ctx => {
  const out: { question_id: string; clue_id: string; label: string; cost: number; bought: boolean }[] = [];
  for (const p of ctx.db.lobby_player.identity.filter(ctx.sender)) {
    const r = ctx.db.market_round.id.find(p.lobby_id);
    if (!r || r.status !== 'running') continue;
    const cat = catalogue(ctx, p.lobby_id);
    for (const q of ctx.db.market_question.lobby_id.filter(p.lobby_id)) {
      for (const c of cat[rawId(p.lobby_id, q.id)] ?? []) {
        const bought = !!ctx.db.clue_purchase.key.find(`${q.id}|${ctx.sender.toHexString()}|${c.id}`);
        out.push({ question_id: q.id, clue_id: c.id, label: c.label, cost: c.cost, bought });
      }
    }
  }
  return out;
});

// The caller's own purchases, with the clue text.
export const my_clues = spacetimedb.view({ name: 'my_clues', public: true }, t.array(clue_purchase.rowType), ctx => [
  ...ctx.db.clue_purchase.identity.filter(ctx.sender),
]);
