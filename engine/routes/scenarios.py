from fastapi import APIRouter

from engine.routes._fixtures import fixture
from engine.schemas import ScenariosResponse

router = APIRouter(tags=["interventions"])


@router.get("/scenarios", response_model=ScenariosResponse)
def scenarios() -> dict:
    return fixture("scenarios")
