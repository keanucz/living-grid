"""README charts, drawn from the project's own data: run `uv run --with matplotlib python scripts/readme_charts.py`.

Writes docs/img/readme/<name>-light.svg and <name>-dark.svg (the README picks one with <picture>). Every number comes
from data/backtest/walk_forward.parquet, data/replay/2026-10-26.json or the live /api/scores; nothing is typed here.
Palette: the dataviz reference categorical slots 1-3 (blue, orange, aqua), validated for both modes; values are
labelled on every mark because light-mode aqua is below 3:1 on the light surface.
"""

import json
import sys
import urllib.request
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data"
OUT = ROOT / "docs" / "img" / "readme"
API = "https://htb.stefvuck.dev/api"

THEMES = {
    "light": {"surface": "#fcfcfb", "text": "#0b0b0b", "muted": "#52514e", "grid": "#e4e3df",
              "s1": "#2a78d6", "s2": "#eb6834", "s3": "#1baf7a", "neutral": "#8a8984"},
    "dark": {"surface": "#1a1a19", "text": "#f0efec", "muted": "#c3c2b7", "grid": "#383835",
             "s1": "#3987e5", "s2": "#d95926", "s3": "#199e70", "neutral": "#8a8984"},
}
ZONES = {"GB": "Britain", "FR": "France", "DE-LU": "Germany", "NL": "Netherlands", "BE": "Belgium", "NO2": "Southern Norway"}
TARGETS = {"price_da": "Day-ahead price", "load": "Demand", "wind": "Wind output", "gb_system_price": "GB system price"}


def style(ax, t):
    ax.set_facecolor(t["surface"])
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(t["grid"])
    ax.tick_params(colors=t["muted"], labelsize=10, length=0)
    ax.grid(axis="x", color=t["grid"], linewidth=0.8)
    ax.set_axisbelow(True)


def figure(t, w=8.4, h=4.4):
    fig, ax = plt.subplots(figsize=(w, h), dpi=100)
    fig.patch.set_facecolor(t["surface"])
    style(ax, t)
    return fig, ax


def title(fig, t, head, sub):
    fig.text(0.012, 0.965, head, color=t["text"], fontsize=13.5, fontweight="bold", va="top")
    fig.text(0.012, 0.905, sub, color=t["muted"], fontsize=10, va="top")


def save(fig, name, mode):
    OUT.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT / f"{name}-{mode}.svg", facecolor=fig.get_facecolor())
    fig.savefig(OUT / f"{name}-{mode}.png", facecolor=fig.get_facecolor(), dpi=110)  # preview only, not committed
    plt.close(fig)


def weighted(df, value):
    return (df[value] * df["n"]).sum() / df["n"].sum()


def chart_error_by_zone(wf, mode):
    t = THEMES[mode]
    p = wf[wf.target == "price_da"]
    rows = []
    for z, name in ZONES.items():
        g = p[p.zone == z]
        if g.empty:
            continue
        rows.append((name, *(weighted(g[g.model == m], "mae") for m in ("lgbm_q", "yesterday", "persistence"))))
    rows.sort(key=lambda r: r[1])
    fig, ax = figure(t, h=4.6)
    series = [("Our model", t["s1"]), ("Same as yesterday", t["s2"]), ("Price stays put", t["s3"])]
    bar_h, gap = 0.24, 0.03
    for i, (name, *vals) in enumerate(rows):
        for k, ((label, colour), v) in enumerate(zip(series, vals)):
            y = i + (k - 1) * (bar_h + gap)
            ax.barh(y, v, height=bar_h, color=colour, label=label if i == 0 else None)
            ax.text(v + 1.2, y, f"{v:.0f}", va="center", fontsize=9, color=t["muted"])
    ax.set_yticks(range(len(rows)), [r[0] for r in rows], color=t["text"], fontsize=10.5)
    ax.invert_yaxis()
    ax.set_xlabel("Average miss per MWh, £ for Britain and € elsewhere (lower is better)", color=t["muted"], fontsize=10)
    fig.legend(loc="upper left", bbox_to_anchor=(0.012, 0.86), ncol=3, frameon=False, fontsize=10, labelcolor=t["text"],
               handlelength=1.2, columnspacing=1.6)
    title(fig, t, "Day-ahead price: how far off each forecast was",
          f"Walk-forward backtest, {p.fold.nunique()} folds of 7 days the model never saw, "
          f"{int(p[p.model == 'lgbm_q'].n.sum()):,} hours")
    fig.subplots_adjust(left=0.18, right=0.97, top=0.78, bottom=0.12)
    save(fig, "error-by-zone", mode)


def chart_coverage(wf, mode):
    t = THEMES[mode]
    rows = []
    for key, name in TARGETS.items():
        g = wf[(wf.target == key) & (wf.model == "lgbm_q")]
        if not g.empty:
            rows.append((name, weighted(g, "coverage_p10_p90") * 100))
    fig, ax = figure(t, h=3.4)
    for i, (name, v) in enumerate(rows):
        ax.barh(i, v, height=0.5, color=t["s1"])
        ax.text(v + 1, i, f"{v:.1f}%", va="center", fontsize=10, color=t["text"])
    ax.axvline(80, color=t["neutral"], linewidth=1.5, linestyle=(0, (4, 3)))
    ax.text(80, -0.62, "  aim: 80%", color=t["muted"], fontsize=9.5, va="bottom")
    ax.set_yticks(range(len(rows)), [r[0] for r in rows], color=t["text"], fontsize=10.5)
    ax.invert_yaxis()
    ax.set_xlim(0, 100)
    ax.set_xlabel("Share of real outcomes inside our likely range", color=t["muted"], fontsize=10)
    title(fig, t, "Honest uncertainty: how often reality landed inside our range",
          "The likely range (P10 to P90) should hold the real value 8 times out of 10")
    fig.subplots_adjust(left=0.2, right=0.95, top=0.74, bottom=0.17)
    save(fig, "coverage", mode)


def chart_storm(replay, mode):
    t = THEMES[mode]
    s = next(x for x in replay["series"] if x["zone"] == "GB" and x["target"] == "price_da")
    pts = pd.DataFrame(s["points"])
    pts["ts"] = pd.to_datetime(pts["ts"])
    pts = pts.dropna(subset=["actual", "p50"])
    fig, ax = figure(t, h=4.2)
    ax.grid(axis="y", color=t["grid"], linewidth=0.8)
    ax.grid(axis="x", visible=False)
    ax.fill_between(pts.ts, pts.p10, pts.p90, color=t["s2"], alpha=0.22, linewidth=0, label="Our likely range")
    ax.plot(pts.ts, pts.p50, color=t["s2"], linewidth=2, label="Our best guess")
    ax.plot(pts.ts, pts.actual, color=t["s1"], linewidth=2, label="What happened")
    inside = ((pts.actual >= pts.p10) & (pts.actual <= pts.p90)).mean() * 100
    ax.set_ylabel(f"Britain, {s['unit'].replace('GBP/MWh', '£ per MWh')}", color=t["muted"], fontsize=10)
    ax.xaxis.set_major_formatter(matplotlib.dates.DateFormatter("%H:%M"))
    ax.set_xlabel("26 October 2026, hour (UTC)", color=t["muted"], fontsize=10)
    fig.legend(loc="upper left", bbox_to_anchor=(0.012, 0.82), ncol=3, frameon=False, fontsize=10, labelcolor=t["text"],
               handlelength=1.6, columnspacing=1.6)
    title(fig, t, "The 26 October storm, replayed",
          f"Forecasts made 12 hours ahead by a model trained only on data before the storm.\n"
          f"{inside:.0f}% of Britain's hours landed inside the range: the storm caught it out, and we show that.")
    fig.subplots_adjust(left=0.1, right=0.97, top=0.72, bottom=0.14)
    save(fig, "storm-replay", mode)


def chart_battery(scores, mode):
    t = THEMES[mode]
    b = pd.DataFrame(scores["battery"])
    b = b[b.strategy.isin(["risk_aware", "median_only", "naive"]) & b.share_of_perfect.notna()]
    zones = [z for z in ZONES if z in set(b.zone)]
    fig, ax = figure(t, h=4.2)
    series = [("risk_aware", "Plans with our likely range", t["s1"]), ("median_only", "Plans with our best guess", t["s2"]),
              ("naive", "Simple rule: buy at night, sell evening", t["s3"])]
    bar_h, gap = 0.24, 0.03
    for i, z in enumerate(zones):
        for k, (key, label, colour) in enumerate(series):
            row = b[(b.zone == z) & (b.strategy == key)]
            if row.empty:
                continue
            v = float(row.share_of_perfect.iloc[0]) * 100
            y = i + (k - 1) * (bar_h + gap)
            ax.barh(y, max(v, 0), height=bar_h, color=colour, label=label if i == 0 else None)
            ax.text(max(v, 0) + 1, y, f"{v:.0f}%", va="center", fontsize=9, color=t["muted"])
    ax.set_yticks(range(len(zones)), [ZONES[z] for z in zones], color=t["text"], fontsize=10.5)
    ax.invert_yaxis()
    ax.set_xlim(0, 115)
    ax.set_xlabel("Profit as a share of a battery with perfect hindsight", color=t["muted"], fontsize=10)
    fig.legend(loc="upper left", bbox_to_anchor=(0.012, 0.86), ncol=3, frameon=False, fontsize=9.5, labelcolor=t["text"],
               handlelength=1.2, columnspacing=1.4)
    title(fig, t, "A 1 MW battery trading on our forecasts",
          f"Snapshot of {scores['headline'].get('battery_hours')} settled hours at {pd.Timestamp(scores['as_of']).strftime('%H:%M UTC, %d %b %Y')}; "
          "the live app keeps scoring")
    fig.subplots_adjust(left=0.18, right=0.97, top=0.78, bottom=0.12)
    save(fig, "battery", mode)


def main():
    wf = pd.read_parquet(DATA / "backtest" / "walk_forward.parquet")
    replay = json.loads((DATA / "replay" / "2026-10-26.json").read_text())
    with urllib.request.urlopen(f"{API}/scores", timeout=30) as r:
        scores = json.load(r)
    for mode in THEMES:
        chart_error_by_zone(wf, mode)
        chart_coverage(wf, mode)
        chart_storm(replay, mode)
        chart_battery(scores, mode)
    print("wrote", sorted(p.name for p in OUT.glob("*.svg")))


if __name__ == "__main__":
    main()
