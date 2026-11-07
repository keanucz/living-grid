from fastapi import APIRouter, HTTPException

from engine import datacentre as dc
from engine.schemas import DataCentreRequest, DataCentreResponse

router = APIRouter(tags=["datacentre"])


def run(**kw) -> dict:
    try:
        return dc.build(**kw)
    except dc.BadRequest as e:
        raise HTTPException(422, str(e)) from None


@router.get("/datacentre", response_model=DataCentreResponse)
def datacentre(locations: str = "GB", gpus: int = dc.DEFAULTS["gpus"], gpu_type: str = dc.DEFAULTS["gpu_type"], pue: float | None = None,
               utilisation: float = dc.DEFAULTS["utilisation"], flexible_share: float = dc.DEFAULTS["flexible_share"]) -> dict:
    """Cost, carbon and grid notes for a GPU site; `locations` is a comma-separated list of up to 3 zones or GB region letters."""
    return run(locations=[x for x in locations.split(",") if x.strip()], gpus=gpus, gpu_type=gpu_type, pue=pue,
               utilisation=utilisation, flexible_share=flexible_share)


@router.post("/datacentre", response_model=DataCentreResponse)
def datacentre_post(body: DataCentreRequest) -> dict:
    return run(**body.model_dump())
