import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

_startup_time = datetime.now(timezone.utc)

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .database import engine, Base, SessionLocal
from .models import TtsEntry
from .routers import tts, cal, pom, mtg, idx, strings, crd

logger = logging.getLogger(__name__)

db_ready = False


def _close_open_tts_entries() -> None:
    """Close any TTS entries still open at 23:00. Runs in APScheduler's thread pool."""
    eod = datetime.now().replace(hour=23, minute=0, second=0, microsecond=0)
    db = SessionLocal()
    try:
        open_entries = db.query(TtsEntry).filter(TtsEntry.end_time.is_(None)).all()
        for entry in open_entries:
            entry.end_time = eod
        if open_entries:
            db.commit()
            logger.info("EOD scheduler: closed %d open TTS entr%s at %s",
                        len(open_entries),
                        "y" if len(open_entries) == 1 else "ies",
                        eod.strftime("%H:%M"))
        else:
            logger.debug("EOD scheduler: no open TTS entries to close")
    except Exception as exc:
        logger.error("EOD scheduler: failed to close entries: %s", exc)
        db.rollback()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_ready
    for attempt in range(1, 6):
        try:
            Base.metadata.create_all(bind=engine)
            db_ready = True
            logger.info("DB tables ready")
            break
        except Exception as exc:
            logger.warning("DB init attempt %d/5 failed: %s", attempt, exc)
            if attempt < 5:
                await asyncio.sleep(2)
    if not db_ready:
        logger.error("DB init failed after 5 attempts — running without DB")

    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        _close_open_tts_entries,
        CronTrigger(hour=23, minute=0),
        misfire_grace_time=3600,  # run immediately on startup if missed within the last hour
    )
    scheduler.start()
    logger.info("EOD scheduler started — TTS entries will auto-close at 23:00")

    yield

    scheduler.shutdown(wait=False)
    logger.info("EOD scheduler stopped")


app = FastAPI(title="endermatx API", lifespan=lifespan)

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
GAMES_DIR = Path(__file__).parent.parent / "games"

# /games and /games/ must be explicit routes registered BEFORE the StaticFiles
# mount.  Starlette stops at the first full match in registration order, so
# without these the mount would intercept /games/ and serve the old static
# games/index.html instead of the React SPA.
@app.get("/games")
@app.get("/games/")
async def games_page():
    index = FRONTEND_DIST / "index.html"
    if index.exists():
        return FileResponse(index)
    return {"status": "api running"}


if GAMES_DIR.exists():
    app.mount("/games", StaticFiles(directory=GAMES_DIR, html=True), name="games")


@app.get("/health")
async def health():
    return JSONResponse({"status": "ok", "db": db_ready})


@app.get("/api/info")
async def info():
    project_id  = os.environ.get("RAILWAY_PROJECT_ID", "")
    service_id  = os.environ.get("RAILWAY_SERVICE_ID", "")
    deploy_url  = None
    if project_id and service_id:
        deploy_url = f"https://railway.com/project/{project_id}/service/{service_id}"
    elif project_id:
        deploy_url = f"https://railway.com/project/{project_id}"
    return JSONResponse({
        "started_at": _startup_time.isoformat(),
        "deploy_url": deploy_url,
    })


@app.get("/")
async def root():
    index = FRONTEND_DIST / "index.html"
    if index.exists():
        return FileResponse(index)
    return {"status": "api running"}


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    candidate = FRONTEND_DIST / full_path
    if full_path and candidate.is_file():
        return FileResponse(candidate)
    index = FRONTEND_DIST / "index.html"
    if index.exists():
        return FileResponse(index)
    return {"status": "api running"}
