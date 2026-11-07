"""A link trips: the importing side loses that supply, the exporting side keeps it at home."""


from engine import data
from engine.interventions.base import Shock, clamp, evaluate

DEFAULT_LINK = "nsl"
MAX_HOURS = 24 * 7
NAMES = {"NO2": "Norway", "FR": "France", "NL": "the Netherlands", "BE": "Belgium", "DE-LU": "Germany", "GB": "GB"}


def run(req, features=None) -> dict:
    links = {link["id"]: link for link in data.interconnectors()}
    link = links.get(req.target or DEFAULT_LINK)
    if link is None:
        raise ValueError(f"unknown interconnector {req.target!r}; one of {sorted(links)}")
    a, b, cap = link["from_zone"], link["to_zone"], link["capacity_mw"]

    ts = data.latest_price_ts()
    recent = {f["interconnector_id"]: f["mw"] for f in data.link_flows(ts)} if ts is not None else {}
    flow = recent.get(link["id"], -0.7 * cap)  # positive a -> b; default: importing into a at 70%
    direction = 1.0 if flow >= 0 else -1.0
    magnitude, clamped = clamp(abs(req.magnitude) if req.magnitude is not None else abs(flow), 0.0, cap)
    hours, h_clamped = clamp(req.hours or 24, 1, MAX_HOURS)

    f = direction * magnitude  # lost flow a -> b
    residual = {a: -f, b: f}  # exporter keeps supply at home; importer must replace it
    importer, exporter = (b, a) if f > 0 else (a, b)

    def edit(feats):
        for zone, d in residual.items():
            m = feats["zone"] == zone
            feats.loc[m, "residual_load_mw"] += d
            feats.loc[m, "import_net_mw"] += -d if zone == importer else d
        return feats

    return evaluate(
        req,
        Shock(
            title=f"{link['name']} trips",
            target=link["id"],
            magnitude=magnitude,
            hours=int(hours),
            clamped=clamped or h_clamped,
            group="imports",
            phrase=f"less from {NAMES.get(exporter, exporter)}",
            edit=edit,
            residual_mw={z: d for z, d in residual.items() if z in data.ZONES},
        ),
        features,
    )


