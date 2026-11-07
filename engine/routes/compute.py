from datetime import datetime

from fastapi import APIRouter, HTTPException

from engine import compute as c
from engine.schemas import ComputeResponse

router = APIRouter(tags=["household"])


@router.get("/compute", response_model=ComputeResponse)
def compute(kw: float = c.DEFAULT_KW, hours: int = c.DEFAULT_HOURS, zones: str | None = None,
            deadline: datetime | None = None, at: datetime | None = None) -> dict:
    """Cheapest start per zone for a job drawing `kw` for `hours`, before `deadline` (default 24 h ahead).

    `zones` is a comma-separated list (default all); `at` replays the answer as of an earlier time.
    """
    try:
        return c.build(kw, hours, zones, deadline, at)
    except c.BadRequest as e:
        raise HTTPException(422, str(e)) from None
