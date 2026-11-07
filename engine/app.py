import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from engine.routes import discover

app = FastAPI(title="The Living Grid", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health() -> dict:
    return {"ok": True, "offline": os.environ.get("LG_OFFLINE") == "1"}


for router in discover():
    app.include_router(router)
