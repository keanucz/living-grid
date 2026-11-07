from fastapi import APIRouter, HTTPException

from engine import household as hh
from engine.schemas import HouseholdResponse

router = APIRouter(tags=["household"])


@router.get("/household", response_model=HouseholdResponse)
def household(region: str = "N") -> dict:
    try:
        return hh.build(region.upper())
    except hh.UnknownRegion:
        raise HTTPException(404, f"unknown region {region!r}; use one of {', '.join(hh.regions())}") from None
