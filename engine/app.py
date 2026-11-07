import os

from fastapi import FastAPI

app = FastAPI(title="The Living Grid")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "offline": os.environ.get("LG_OFFLINE") == "1"}
