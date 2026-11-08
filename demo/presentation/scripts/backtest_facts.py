"""Pooled day-ahead price figures for the six forecasters, read from the backtest files. Prints one JSON object.
Usage: backtest_facts.py <dir holding walk_forward.parquet, bot_league.parquet, evaluation.json>"""
import json
import sys
from pathlib import Path

import pandas as pd

d = Path(sys.argv[1])
wf = pd.read_parquet(d / 'walk_forward.parquet')
bl = pd.read_parquet(d / 'bot_league.parquet')
ev = json.loads((d / 'evaluation.json').read_text())


def pooled(df, models):
    df = df[(df.target == 'price_da') & df.model.isin(models)].copy()
    df['w'] = df.mae * df.n
    df['c'] = df.coverage_p10_p90 * df.n
    g = df.groupby('model').agg(w=('w', 'sum'), n=('n', 'sum'), c=('c', 'sum'))
    return {m: {'mae': float(r.w / r.n), 'coverage': (float(r.c / r.n) if r.c == r.c and r.c > 0 else None), 'n': int(r.n)} for m, r in g.iterrows()}


rows = pooled(bl, ['lgbm_q', 'bot_yesterday', 'bot_last_week', 'bot_engineer', 'bot_committee'])
rows.update(pooled(wf, ['persistence']))
dm = [r for r in ev['dm'] if r['target'] == 'price_da' and r['baseline'] == 'persistence']
cov = {m: r['coverage'] for m, r in rows.items() if r['coverage'] is not None}
print(json.dumps({
    'source': 'walk_forward.parquet, bot_league.parquet, evaluation.json',
    'folds': ev['config']['folds'], 'test_days': ev['config']['test_days'], 'generated_at': ev['generated_at'],
    'models': rows,
    'lowest_error': min(rows, key=lambda m: rows[m]['mae']),
    'best_calibrated': min(cov, key=lambda m: abs(cov[m] - 0.8)),
    'dm_persistence_zones': len(dm), 'dm_persistence_significant': sum(1 for r in dm if r['significant']),
}))
