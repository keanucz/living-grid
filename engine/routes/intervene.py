import logging
from functools import cache

from fastapi import APIRouter, BackgroundTasks, HTTPException

from engine import publisher
from engine.interventions import registry
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


@router.post("/intervene", response_model=InterventionResult)
def intervene(req: InterventionRequest, background: BackgroundTasks) -> dict:
    run = registry().get(req.type)
    if run is None:  # event not implemented yet: serve its pre-computed fixture
        by_type = {s["result"]["request"]["type"]: s["result"] for s in fixture("scenarios")["scenarios"]}
        return {**by_type.get(req.type, fixture("intervene")), "request": req.model_dump()}
    try:
        result = InterventionResult.model_validate(run(req)).model_dump(mode="json")
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    background.add_task(_publish, result)
    return result
