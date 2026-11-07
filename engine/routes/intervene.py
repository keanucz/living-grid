from fastapi import APIRouter

from engine.routes._fixtures import fixture
from engine.schemas import InterventionRequest, InterventionResult

router = APIRouter(tags=["interventions"])


@router.post("/intervene", response_model=InterventionResult)
def intervene(req: InterventionRequest) -> dict:
    by_type = {s["result"]["request"]["type"]: s["result"] for s in fixture("scenarios")["scenarios"]}
    result = by_type.get(req.type, fixture("intervene"))
    return {**result, "request": req.model_dump()}
