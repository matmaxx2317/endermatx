import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .database import engine, Base
from .routers import tts, cal, pom, mtg, idx, strings, crd

Base.metadata.create_all(bind=engine)

app = FastAPI(title="endermatx API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tts.router, prefix="/api/tts", tags=["tts"])
app.include_router(cal.router, prefix="/api/cal", tags=["cal"])
app.include_router(pom.router, prefix="/api/pom", tags=["pom"])
app.include_router(mtg.router, prefix="/api/mtg", tags=["mtg"])
app.include_router(idx.router, prefix="/api/idx", tags=["idx"])
app.include_router(strings.router, prefix="/api/str", tags=["str"])
app.include_router(crd.router, prefix="/api/crd", tags=["crd"])

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    if FRONTEND_DIST.exists():
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        index = FRONTEND_DIST / "index.html"
        if index.exists():
            return FileResponse(index)
    return {"status": "api running"}
