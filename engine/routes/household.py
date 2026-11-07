from fastapi import APIRouter, HTTPException

from engine import household as hh
from engine import household_savings as hs
from engine.schemas import HouseholdResponse, HouseholdSavingsResponse

router = APIRouter(tags=["household"])


@router.get("/household", response_model=HouseholdResponse)
def household(region: str = "N") -> dict:
    try:
        return hh.build(region.upper())
    except hh.UnknownRegion:
        raise HTTPException(404, f"unknown region {region!r}; use one of {', '.join(hh.regions())}") from None


@router.get("/household/savings", response_model=HouseholdSavingsResponse)
def household_savings(region: str = "N", devices: str = "ev,dishwasher,washing_machine", fixed_p_kwh: float | None = None) -> dict:
    try:
        return hs.build(region.upper(), [d for d in devices.split(",") if d], fixed_p_kwh)
    except hh.UnknownRegion:
        raise HTTPException(404, f"unknown region {region!r}; use one of {', '.join(hh.regions())}") from None
    except hs.UnknownDevice as e:
        raise HTTPException(422, f"unknown device {e.args[0]!r}; use any of {', '.join(hs.DEVICES)}") from None
