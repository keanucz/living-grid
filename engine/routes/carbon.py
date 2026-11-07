from datetime import datetime

from fastapi import APIRouter

from engine.routes._fixtures import fixture
from engine.schemas import CarbonResponse

router = APIRouter(tags=["unseen"])


@router.get("/unseen/carbon", response_model=CarbonResponse)
def carbon(at: datetime | None = None) -> dict:
    return fixture("carbon")
