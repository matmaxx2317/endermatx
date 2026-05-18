import os
import re
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import SessionLocal

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/stats")
def bpm_stats(db: Session = Depends(get_db)):
    from sqlalchemy import func, case
    row = db.query(
        func.count().label("total"),
        func.sum(case((models.TrackBpm.source == "getsongbpm", 1), else_=0)).label("getsongbpm"),
        func.sum(case((models.TrackBpm.source == "not_found",  1), else_=0)).label("not_found"),
    ).one()
    return {
        "total":      row.total      or 0,
        "getsongbpm": row.getsongbpm or 0,
        "not_found":  row.not_found  or 0,
    }


@router.post("/batch-lookup", response_model=list[schemas.TrackBpmOut])
def batch_lookup(body: schemas.BatchLookupRequest, db: Session = Depends(get_db)):
    if not body.spotify_ids:
        return []
    return db.query(models.TrackBpm).filter(
        models.TrackBpm.spotify_id.in_(body.spotify_ids)
    ).all()


_TITLE_NOISE = re.compile(
    r'\s*[\(\[]'
    r'(?:feat\.?|ft\.?|featuring|with|prod\.?|produced by'
    r'|radio edit|album version|single version|extended|remaster(?:ed)?(?:\s+\d{4})?'
    r'|live|acoustic|instrumental|explicit|bonus track|interlude'
    r'|original mix|club mix|remix|edit)'
    r'[^\)\]]*[\)\]]'
    r'|\s+-\s+(?:feat\.?|ft\.?|featuring|remaster(?:ed)?(?:\s+\d{4})?|radio edit|live|acoustic|remix).*$',
    re.IGNORECASE,
)

def _clean_title(title: str) -> str:
    return _TITLE_NOISE.sub('', title).strip()


def _getsong_search(api_key: str, title: str):
    app_url = os.getenv("GETSONGBPM_APP_URL", "https://matmaxx.org/spt")
    return httpx.get(
        "https://api.getsong.co/search/",
        params={"api_key": api_key, "type": "song", "lookup": title},
        headers={
            "Referer": app_url,
            "Origin":  app_url,
            "User-Agent": "Mozilla/5.0 (compatible; endermatx/1.0)",
        },
        timeout=10,
    )


def _pick_best(results: list, artist: str) -> dict | None:
    """Return the result whose artist name best matches, falling back to first with a tempo."""
    artist_lower = artist.lower()
    for r in results:
        name = (r.get("artist") or {}).get("name", "").lower()
        if artist_lower and (artist_lower in name or name in artist_lower):
            if r.get("tempo"):
                return r
    for r in results:
        if r.get("tempo"):
            return r
    return None


def _getsong_results(api_key: str, title: str) -> list:
    """Return search results list for a title, or [] on any failure."""
    try:
        r = _getsong_search(api_key, title)
        if not r.is_success:
            return []
        data = r.json()
        results = (data or {}).get("search") or []
        return results if isinstance(results, list) else []
    except Exception:
        return []


@router.get("/getsongbpm")
def getsongbpm_lookup(title: str = Query(...), artist: str = Query(...)):
    api_key = os.getenv("GETSONGBPM_API_KEY", "")
    if not api_key:
        raise HTTPException(503, "GetSongBPM not configured")

    # Pass 1: full title
    results = _getsong_results(api_key, title)

    # Pass 2: cleaned title (strip feat., remaster tags, etc.) if pass 1 found nothing
    cleaned = _clean_title(title)
    if not results and cleaned != title:
        results = _getsong_results(api_key, cleaned)

    if not results:
        return {"bpm": None}

    match = _pick_best(results, artist)
    if not match:
        return {"bpm": None}

    try:
        return {"bpm": round(float(match["tempo"]))}
    except (ValueError, TypeError):
        return {"bpm": None}


@router.delete("/all")
def wipe_all(db: Session = Depends(get_db)):
    try:
        deleted = db.query(models.TrackBpm).delete()
        db.commit()
        return {"deleted": deleted}
    except Exception as e:
        db.rollback()
        raise HTTPException(500, str(e))


@router.post("/store", response_model=schemas.TrackBpmOut)
def store_bpm(body: schemas.TrackBpmIn, db: Session = Depends(get_db)):
    existing = db.get(models.TrackBpm, body.spotify_id)
    if existing:
        if existing.source == 'not_found' and body.source != 'not_found':
            existing.bpm    = body.bpm
            existing.source = body.source
            existing.title  = body.title
            existing.artist = body.artist
            db.commit()
            db.refresh(existing)
        return existing
    entry = models.TrackBpm(**body.model_dump(), created_at=datetime.utcnow())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry
