"""HTTP API contract (B provides to C). Changing anything here needs the team's agreement.

Every number shown to a judge carries a `kind` so the UI can label it honestly:
actual (metered or published), forecast (our model), modelled (derived from a model or
standard factors), estimated (rough inference, e.g. ghost wind), scenario (an intervention result).
"""

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Zone = Literal["GB", "FR", "DE-LU", "NL", "BE", "NO2"]
Kind = Literal["actual", "forecast", "modelled", "estimated", "scenario"]
Currency = Literal["GBP", "EUR"]
Group = Literal["wind", "solar", "demand", "gas", "carbon", "imports", "time_of_day"]
InterventionType = Literal[
    "hormuz",
    "interconnector_trip",
    "nuclear_outage",
    "wind",
    "cold_snap",
    "carbon_price",
    "scottish_storm",
]
BatteryStrategy = Literal["median_only", "risk_aware", "naive", "perfect_foresight"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------- shared pieces ----------


class Quantiles(Model):
    p10: float
    p50: float
    p90: float


class Contribution(Model):
    group: Group
    value: float = Field(description="Contribution to the price in the zone's currency per MWh")


class Explanation(Model):
    sentence: str = Field(description='e.g. "GB price up £18: wind down 40% (+£12), less from Norway (+£5)"')
    contributions: list[Contribution]
    kind: Kind = "forecast"


# ---------- GET /zones ----------


class ZoneInfo(Model):
    zone: Zone
    name: str
    currency: Currency
    centroid: tuple[float, float] = Field(description="[lon, lat]")
    approximate_border: bool


class Interconnector(Model):
    id: str
    name: str
    from_zone: str
    to_zone: str
    capacity_mw: float
    from_coord: tuple[float, float] = Field(description="[lon, lat] landing in from_zone")
    to_coord: tuple[float, float] = Field(description="[lon, lat] landing in to_zone")
    in_v1: bool


class GbRegion(Model):
    region: str = Field(description="Agile region letter A to P")
    name: str
    dno: str
    carbon_intensity_region_id: int


class ZonesResponse(Model):
    zones: list[ZoneInfo]
    interconnectors: list[Interconnector]
    gb_regions: list[GbRegion]
    zones_geojson: dict[str, Any] = Field(description="FeatureCollection, properties.zone")
    gb_regions_geojson: dict[str, Any] = Field(description="FeatureCollection, properties.region")


# ---------- GET /state?at= ----------


class PriceNow(Model):
    value: float
    unit: str = Field(description="e.g. GBP/MWh or EUR/MWh")
    kind: Kind = "actual"
    source: str


class ForecastNow(Quantiles):
    made_at: datetime
    horizon_h: int
    target: str
    kind: Kind = "forecast"


class CarbonNow(Model):
    production_gco2_kwh: float
    consumption_gco2_kwh: float
    imports_share: float
    kind: Kind = "modelled"


class ZoneState(Model):
    zone: Zone
    price: PriceNow | None
    forecast: ForecastNow | None
    carbon: CarbonNow | None
    load_mw: float | None
    mix_mw: dict[str, float] = Field(description="Generation by fuel in MW, e.g. wind, gas, nuclear")


class Flow(Model):
    interconnector_id: str
    from_zone: str
    to_zone: str
    mw: float = Field(description="Positive means from_zone to to_zone")
    capacity_mw: float
    kind: Kind = "actual"


class StateResponse(Model):
    at: datetime
    zones: list[ZoneState]
    flows: list[Flow]


# ---------- GET /explain?zone=&ts= ----------


class ExplainResponse(Explanation):
    zone: Zone
    ts: datetime
    target: str
    base: float = Field(description="Model baseline (expected value) for this target")
    prediction: float
    delta: float = Field(description="prediction minus a reference (e.g. same hour yesterday)")
    unit: str


# ---------- GET /unseen/ghost-wind?from=&to= ----------


class GhostWindPoint(Model):
    ts: datetime
    boalf_mw: float = Field(description="Accepted bids to switch off, mapped wind units")
    weather_gap_mw: float = Field(description="Weather-implied output minus metered output")


class GhostWindRegion(Model):
    region: str
    name: str
    centroid: tuple[float, float] = Field(description="[lon, lat]")
    boalf_mwh: float
    weather_gap_mwh: float
    series: list[GhostWindPoint]
    kind: Kind = "estimated"


class ConstraintCost(Model):
    date: date
    gbp: float
    kind: Kind = "actual"


class BoundaryFlow(Model):
    boundary: str
    ts: datetime
    flow_mw: float
    limit_mw: float
    kind: Kind = "forecast"


class GhostWindResponse(Model):
    from_: datetime = Field(alias="from")
    to: datetime
    regions: list[GhostWindRegion]
    total_boalf_mwh: float
    total_weather_gap_mwh: float
    constraint_costs: list[ConstraintCost]
    constraint_cost_total_gbp: float
    boundary_flows: list[BoundaryFlow]
    note: str

    model_config = ConfigDict(extra="forbid", populate_by_name=True, serialize_by_alias=True)


# ---------- GET /unseen/carbon?at= ----------


class ImportContribution(Model):
    from_zone: str
    mw: float
    exporter_gco2_kwh: float
    contribution_gco2_kwh: float = Field(description="Share of the importer's consumption intensity")


class ZoneCarbon(Model):
    zone: Zone
    production_gco2_kwh: float
    consumption_gco2_kwh: float
    imports_share: float
    imports: list[ImportContribution]
    kind: Kind = "modelled"


class CarbonResponse(Model):
    at: datetime
    zones: list[ZoneCarbon]
    note: str = "Emission factors are standard estimates; consumption intensity is modelled."


# ---------- POST /intervene ----------


class InterventionRequest(Model):
    type: InterventionType
    target: str | None = Field(None, description="Zone or interconnector id; defaults per type")
    magnitude: float | None = Field(None, description="Percent, MW or EUR/t depending on type; defaults per type")
    hours: int | None = Field(None, ge=1, le=24 * 28, description="Duration; defaults per type")


class HourDelta(Model):
    ts: datetime
    delta_p10: float
    delta_p50: float
    delta_p90: float


class ZoneImpact(Model):
    zone: Zone
    currency: Currency
    avg_delta: float = Field(description="Mean price change per MWh over the event")
    cost: float = Field(description="Price change x demand x hours, in the zone's currency")
    cost_gbp: float
    hourly: list[HourDelta]


class Party(Model):
    who: str
    gbp: float


class BatteryResponse(Model):
    zone: Zone
    profit_before: float
    profit_after: float
    currency: Currency
    note: str


class GhostWindChange(Model):
    delta_mwh: float
    delta_constraint_cost_gbp: float
    kind: Kind = "estimated"


class InterventionResult(Model):
    id: str
    triggered_at: datetime
    request: InterventionRequest
    applied_magnitude: float
    applied_hours: int
    target: str
    clamped: bool = Field(description="Magnitude clamped to the range seen in training data")
    title: str
    zones: list[ZoneImpact]
    cost_total_gbp: Quantiles
    winners: list[Party]
    losers: list[Party]
    explanation: Explanation
    battery: list[BatteryResponse]
    ghost_wind: GhostWindChange | None = None
    method_note: str
    kind: Kind = "scenario"


# ---------- GET /scenarios ----------


class Scenario(Model):
    key: str
    title: str
    blurb: str
    result: InterventionResult


class ScenariosResponse(Model):
    scenarios: list[Scenario]


# ---------- GET /scores ----------


class Headline(Model):
    mae_model: float
    mae_persistence: float
    coverage_p10_p90: float
    forecasts_scored: int
    since: datetime
    battery_share_of_perfect: float | None = Field(
        description="Risk-aware profit / perfect-foresight profit, pooled over zones and hours; null when too few "
        "hours have settled or perfect foresight earns too little for the ratio to mean anything"
    )
    battery_hours: int | None = Field(None, description="Zone-hours settled on real prices behind the battery share")
    battery_note: str | None = Field(None, description="Why the battery share is null, or how it was computed")
    sentence: str


class ZoneScore(Model):
    zone: Zone
    target: str
    model: str
    mae: float
    coverage_p10_p90: float | None
    n: int


class BacktestRow(Model):
    fold: int
    zone: Zone
    target: str
    model: str
    mae: float
    coverage_p10_p90: float | None
    n: int


class BatteryResult(Model):
    strategy: BatteryStrategy
    zone: Zone
    profit: float
    currency: Currency
    share_of_perfect: float | None = Field(description="Null when perfect foresight earns too little in this zone")
    worst_hour_loss: float


class ScoresResponse(Model):
    as_of: datetime
    headline: Headline
    live: list[ZoneScore]
    backtest: list[BacktestRow]
    battery: list[BatteryResult]


# ---------- GET /household?region= ----------


class HouseholdPrice(Model):
    ts: datetime
    p_kwh: float = Field(description="Pence per kWh incl. VAT")
    p10: float | None = None
    p90: float | None = None
    kind: Kind = Field(description="actual for published Agile, forecast beyond it")


class HouseholdWindow(Model):
    task: Literal["ev", "dishwasher", "washing_machine"]
    label: str
    start: datetime
    end: datetime
    avg_p_kwh: float
    saving_gbp: Quantiles = Field(description="Saving against running it now (or at 17:00 to 19:00)")
    kind: Kind


class HouseholdResponse(Model):
    region: str
    name: str
    generated_at: datetime
    windows: list[HouseholdWindow]
    prices: list[HouseholdPrice]
    note: str


# ---------- GET /compute?kw=&hours=&zones=&deadline= ----------


class ComputePrice(Model):
    ts: datetime
    p10: float
    p50: float
    p90: float
    kind: Kind = Field(description="actual where the day-ahead auction has cleared, forecast beyond it")


class ComputeZone(Model):
    zone: Zone
    currency: Currency
    unit: str = Field(description="Price unit, e.g. EUR/MWh")
    start: datetime = Field(description="Best start hour before the deadline")
    end: datetime
    avg_price: Quantiles = Field(description="Mean wholesale price over the best window, in unit")
    cost: Quantiles = Field(description="Energy cost of the job in the best window, in currency")
    cost_now: Quantiles = Field(description="Energy cost if started at the next hour, in currency")
    saving: Quantiles = Field(description="cost_now minus cost, in currency")
    cost_eur: Quantiles = Field(description="cost converted to EUR so zones compare")
    saving_eur: Quantiles
    kind: Kind = Field(description="actual only when every hour of both windows has a cleared price")
    prices: list[ComputePrice] = Field(description="Hourly prices from the next hour to the deadline")


class ComputeResponse(Model):
    generated_at: datetime
    kw: float
    hours: int
    deadline: datetime
    eur_per_gbp: float
    zones: list[ComputeZone] = Field(description="Cheapest first by cost_eur.p50; zones without prices are left out")
    cheapest_zone: Zone | None
    note: str


# ---------- GET /replay?event= ----------


class ReplayPoint(Model):
    ts: datetime
    actual: float | None
    p10: float
    p50: float
    p90: float
    made_at: datetime
    explanation: str | None = None


class ReplaySeries(Model):
    zone: Zone
    target: str
    unit: str
    points: list[ReplayPoint]


class ReplayResponse(Model):
    event: date
    title: str
    trained_before: date = Field(description="As-of models saw no data on or after this date")
    series: list[ReplaySeries]
    constraint_cost_gbp: float
    summary: str


# ---------- GET /reveal ----------


class RevealHour(Quantiles):
    ts: datetime
    actual: float | None


class RevealZone(Model):
    zone: Zone
    currency: Currency
    published: bool
    hours: list[RevealHour]
    mae: float | None
    inside_band_share: float | None


class RevealResponse(Model):
    delivery_date: date
    frozen_at: datetime
    zones: list[RevealZone]
    zones_published: int
    mean_abs_error: float | None
    zones_inside_band: int | None
