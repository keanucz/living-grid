from fastapi import APIRouter

from engine.routes._fixtures import fixture
from engine.schemas import HouseholdResponse

router = APIRouter(tags=["household"])


@router.get("/household", response_model=HouseholdResponse)
def household(region: str = "N") -> dict:
    return fixture("household")
