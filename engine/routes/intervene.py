import logging
from functools import cache

from fastapi import APIRouter, BackgroundTasks, HTTPException, Response

from engine import publisher
from engine.interventions import registry
from engine.interventions.results_cache import RESULTS, start_warmer
from engine.routes._fixtures import fixture
from engine.schemas import InterventionRequest, InterventionResult

router = APIRouter(tags=["interventions"])
log = logging.getLogger(__name__)


@cache
def _client():
    return publisher.from_env()


def _publish(result: dict) -> None:
    try:
        publisher.publish_intervention(_client(), result)
    except Exception:  # live state is best-effort; the HTTP result still stands
        log.exception("publishing intervention to SpacetimeDB failed")


def _compute_for(kind: str):
    run = registry().get(kind)
    if run is None:
        return None

    def compute(req: InterventionRequest) -> dict:
        return InterventionResult.model_validate(run(req)).model_dump(mode="json")

    return compute


@router.on_event("startup")
def _warm() -> None:
    start_warmer(_compute_for, lambda kind: InterventionRequest(type=kind))


@router.post("/intervene", response_model=InterventionResult)
def intervene(req: InterventionRequest, background: BackgroundTasks, response: Response) -> dict:
    compute = _compute_for(req.type)
    if compute is None:  # event not implemented yet: serve its pre-computed fixture
        by_type = {s["result"]["request"]["type"]: s["result"] for s in fixture("scenarios")["scenarios"]}
        return {**by_type.get(req.type, fixture("intervene")), "request": req.model_dump()}
    try:
        result, status = RESULTS.get(req, compute)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    response.headers["X-LG-Cache"] = status
    background.add_task(_publish, result)
    return result
