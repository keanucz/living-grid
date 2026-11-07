from fastapi import APIRouter

from engine.routes._fixtures import fixture
from engine.schemas import ScoresResponse

router = APIRouter(tags=["proof"])


@router.get("/scores", response_model=ScoresResponse)
def scores() -> dict:
    return fixture("scores")
