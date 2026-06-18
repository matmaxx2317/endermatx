import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

_startup_time = datetime.now(timezone.utc)

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from .database import engine, Base, SessionLocal
from .models import TtsEntry, WmtMatch, WmtTeam, SchedulerLog
from .routers import tts, cal, idx, strings, bpm, scan, wmt, drv, log
from .routers.wmt import (
    do_refresh as _wmt_do_refresh,
    do_generate_summary as _wmt_do_summary,
    do_news_adjust as _wmt_do_news_adjust,
)

logger = logging.getLogger(__name__)

db_ready = False

# The WMT refresh job reschedules itself after every run (see _reschedule_wmt),
# so it needs a handle on the scheduler and a stable job id.
scheduler: AsyncIOScheduler | None = None
WMT_REFRESH_JOB_ID = "wmt_refresh"

# Adaptive-scheduling tunables (all UTC-naive timedeltas).
_WMT_MATCH_DURATION = timedelta(minutes=120)  # 90 + half-time + stoppage + slack
_WMT_POST_BUFFER    = timedelta(minutes=5)    # wake this long after a match's end
_WMT_LIVE_POLL      = timedelta(minutes=10)   # re-check cadence for a match that should be over but isn't FINISHED yet
_WMT_MIN_DELAY      = timedelta(minutes=5)    # never fire sooner than this
_WMT_IDLE           = timedelta(hours=6)      # rest-day nap / safety re-eval cap
_WMT_FALLBACK       = timedelta(minutes=30)   # if next-run computation itself errors


def _match_label(db, m) -> str:
    """Short 'HOME-AWAY' label (TLAs) for a match, for log reasons."""
    ids = [i for i in (m.home_team_id, m.away_team_id) if i is not None]
    teams = {t.id: t for t in db.query(WmtTeam).filter(WmtTeam.id.in_(ids)).all()} if ids else {}

    def tla(tid):
        t = teams.get(tid)
        if not t:
            return "?"
        return t.tla or t.short_name or t.name or "?"

    return f"{tla(m.home_team_id)}-{tla(m.away_team_id)}"


def _compute_next_wmt_run(db, now: datetime | None = None) -> tuple[datetime, str]:
    """Decide when the WMT refresh job should next fire, and why (UTC-naive).

    Wakes ~5 min after the next match's expected end; polls every 10 min while a
    match that should already be over hasn't been marked FINISHED yet (extra
    time, penalties, API lag); naps for 6 h when nothing is upcoming. The result
    is always clamped to [now + 5 min, now + 6 h]. Returns (next_run, reason)."""
    now = now or datetime.utcnow()
    unfinished = db.query(WmtMatch).filter(WmtMatch.status != "FINISHED").all()
    if not unfinished:
        target = now + _WMT_IDLE
        reason = "no upcoming matches"
    else:
        # each unfinished match paired with its expected end, earliest first
        ends = sorted(
            ((m.utc_date + _WMT_MATCH_DURATION + _WMT_POST_BUFFER, m) for m in unfinished),
            key=lambda x: x[0],
        )
        overdue = [(t, m) for t, m in ends if t <= now]
        if overdue:
            # match should already be over but isn't FINISHED — poll soon to
            # catch the lagging result before moving on.
            _, m = overdue[0]
            target = now + _WMT_LIVE_POLL
            reason = f"{_match_label(db, m)} not finished yet"
        else:
            target, m = ends[0]
            reason = f"end of {_match_label(db, m)}"

    clamped = max(now + _WMT_MIN_DELAY, min(target, now + _WMT_IDLE))
    if clamped < target:
        # earliest event is >6 h out — nap and re-evaluate then
        reason = f"{reason} (>6h away, re-check)"
    return clamped, reason


def _reschedule_wmt(db) -> tuple[datetime, str]:
    """Re-arm the WMT refresh job for its next adaptive run; return (time, reason)."""
    try:
        next_run, reason = _compute_next_wmt_run(db)
    except Exception as exc:
        logger.error("WMT next-run computation failed: %s — falling back to %s",
                     exc, _WMT_FALLBACK)
        next_run = datetime.utcnow() + _WMT_FALLBACK
        reason = "computation error, retry in 30 min"
    if scheduler is not None:
        try:
            scheduler.add_job(
                _wmt_refresh,
                DateTrigger(run_date=next_run),
                id=WMT_REFRESH_JOB_ID,
                replace_existing=True,
                misfire_grace_time=3600,
            )
            logger.info("WMT refresh: next run at %s UTC (%s)",
                        next_run.strftime("%Y-%m-%d %H:%M"), reason)
        except Exception as exc:
            logger.error("WMT reschedule failed: %s", exc)
    return next_run, reason


def _write_scheduler_log(db, result: str, next_run: datetime | None,
                         next_run_reason: str | None) -> None:
    """Record one scheduler-run row (best effort — never raises)."""
    try:
        db.add(SchedulerLog(
            ran_at=datetime.utcnow(),
            job=WMT_REFRESH_JOB_ID,
            result=result,
            next_run_at=next_run,
            next_run_reason=next_run_reason,
        ))
        db.commit()
    except Exception as exc:
        logger.error("Scheduler log write failed: %s", exc)
        db.rollback()


def _wmt_refresh() -> None:
    """Refresh WM 2026 data, then adaptively re-arm the next run and log it."""
    db = SessionLocal()
    result = "unknown"
    try:
        labels, err = _wmt_do_refresh(db)
        if err:
            result = f"error: {err}"
            logger.warning("WMT refresh: %s", err)
        elif labels:
            n = len(labels)
            # name the matches when few; fall back to a count for bulk loads
            result = ", ".join(labels) if n <= 6 else f"{n} matches updated"
            logger.info("WMT refresh: %s", result)
        else:
            result = "no changes"
            logger.debug("WMT refresh: no changes")
    except Exception as exc:
        result = f"exception: {type(exc).__name__}: {str(exc)[:200]}"
        logger.error("WMT refresh failed: %s", exc)
        db.rollback()
    finally:
        # Always re-arm and log — even on error — so the loop can never die.
        next_run, reason = None, None
        try:
            next_run, reason = _reschedule_wmt(db)
        finally:
            _write_scheduler_log(db, result, next_run, reason)
            db.close()


def _wmt_morning_summary() -> None:
    """Generate morning summary at 04:30 for yesterday's matches."""
    db = SessionLocal()
    try:
        yesterday = date.today() - timedelta(days=1)
        content = _wmt_do_summary(db, yesterday)
        if content:
            logger.info("WMT morning summary generated for %s", yesterday)
        else:
            logger.debug("WMT morning summary: no finished matches for %s", yesterday)
    except Exception as exc:
        logger.error("WMT morning summary failed: %s", exc)
        db.rollback()
    finally:
        db.close()


def _wmt_news_factors() -> None:
    """Update news-based WMT team factors at 07:30 for teams playing within 48h."""
    db = SessionLocal()
    try:
        n, err = _wmt_do_news_adjust(db)
        if err:
            logger.debug("WMT news factors skipped: %s", err)
        else:
            logger.info("WMT news factors: %d adjustment(s) active", n)
    except Exception as exc:
        logger.error("WMT news factors failed: %s", exc)
        db.rollback()
    finally:
        db.close()


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

    global scheduler
    # Pass a tzinfo object, not "utc"/"UTC": APScheduler resolves timezone
    # strings via zoneinfo, which raises ZoneInfoNotFoundError on containers
    # without the IANA tz database. timezone.utc avoids that lookup entirely.
    scheduler = AsyncIOScheduler(timezone=timezone.utc)
    scheduler.add_job(
        _close_open_tts_entries,
        CronTrigger(hour=23, minute=0),
        misfire_grace_time=3600,
    )
    # WMT refresh is a self-rescheduling one-shot: it runs shortly after startup,
    # then re-arms itself (see _reschedule_wmt) to wake ~5 min after the next
    # match ends instead of polling on a fixed interval.
    scheduler.add_job(
        _wmt_refresh,
        DateTrigger(run_date=datetime.utcnow() + timedelta(seconds=15)),
        id=WMT_REFRESH_JOB_ID,
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        _wmt_morning_summary,
        CronTrigger(hour=4, minute=30),
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        _wmt_news_factors,
        CronTrigger(hour=7, minute=30),
        misfire_grace_time=3600,
    )
    scheduler.start()
    logger.info("Scheduler started — TTS EOD at 23:00, WMT refresh adaptive "
                "(~5 min after each match), WMT summary at 04:30, WMT news factors at 07:30")

    yield

    scheduler.shutdown(wait=False)
    logger.info("EOD scheduler stopped")


app = FastAPI(title="endermatx API", lifespan=lifespan)

# Security headers on every response
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        return response

app.add_middleware(SecurityHeadersMiddleware)

# CORS: restrict to configured origins (defaults to local dev server)
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)

app.include_router(tts.router, prefix="/api/tts", tags=["tts"])
app.include_router(cal.router, prefix="/api/cal", tags=["cal"])
app.include_router(idx.router, prefix="/api/idx", tags=["idx"])
app.include_router(strings.router, prefix="/api/str", tags=["str"])
app.include_router(bpm.router,      prefix="/api/bpm",      tags=["bpm"])
app.include_router(scan.router,     prefix="/api/bpm/scan", tags=["scan"])
app.include_router(wmt.router,      prefix="/api/wmt",      tags=["wmt"])
app.include_router(drv.router,      prefix="/api/drv",      tags=["drv"])
app.include_router(log.router,      prefix="/api/log",      tags=["log"])

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
GAMES_DIR = Path(__file__).parent.parent / "games"

# /games and /games/ must be explicit routes registered BEFORE the StaticFiles
# mount.  Starlette stops at the first full match in registration order, so
# without these the mount would intercept /games/ and serve the old static
# games/index.html instead of the React SPA.
NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate"}

@app.get("/games")
@app.get("/games/")
async def games_page():
    index = FRONTEND_DIST / "index.html"
    if index.exists():
        return FileResponse(index, headers=NO_CACHE)
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
        return FileResponse(index, headers=NO_CACHE)
    return {"status": "api running"}


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    dist = FRONTEND_DIST.resolve()
    candidate = (FRONTEND_DIST / full_path).resolve()
    try:
        candidate.relative_to(dist)
        if candidate.is_file():
            return FileResponse(candidate)
    except ValueError:
        pass  # path traversal attempt — fall through to index.html
    index = FRONTEND_DIST / "index.html"
    if index.exists():
        return FileResponse(index, headers=NO_CACHE)
    return {"status": "api running"}
