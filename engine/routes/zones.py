from fastapi import APIRouter

from engine.routes._fixtures import fixture
from engine.schemas import ZonesResponse

router = APIRouter(tags=["map"])


@router.get("/zones", response_model=ZonesResponse)
def zones() -> dict:
    return fixture("zones")
