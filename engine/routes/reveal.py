from fastapi import APIRouter

from engine.routes._fixtures import fixture
from engine.schemas import RevealResponse

router = APIRouter(tags=["proof"])


@router.get("/reveal", response_model=RevealResponse)
def reveal() -> dict:
    return fixture("reveal")
