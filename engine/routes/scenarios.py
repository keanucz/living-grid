from fastapi import APIRouter

from engine import scenarios as sc
from engine.schemas import ScenariosResponse

router = APIRouter(tags=["interventions"])


@router.get("/scenarios", response_model=ScenariosResponse)
def scenarios() -> dict:
    return {"scenarios": sc.load()}
