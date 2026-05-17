import os
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


@router.post("/batch-lookup", response_model=list[schemas.TrackBpmOut])
def batch_lookup(body: schemas.BatchLookupRequest, db: Session = Depends(get_db)):
    if not body.spotify_ids:
        return []
    return db.query(models.TrackBpm).filter(
        models.TrackBpm.spotify_id.in_(body.spotify_ids)
    ).all()


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
    # fallback: first result with a non-null tempo
    for r in results:
        if r.get("tempo"):
            return r
    return None


@router.get("/getsongbpm")
def getsongbpm_lookup(title: str = Query(...), artist: str = Query(...)):
    api_key = os.getenv("GETSONGBPM_API_KEY", "")
    if not api_key:
        raise HTTPException(503, "GetSongBPM not configured")

    try:
        r = _getsong_search(api_key, title)
    except httpx.TimeoutException:
        raise HTTPException(504, "GetSongBPM timeout")
    except Exception:
        return {"bpm": None}

    raw = None
    try:
        raw = r.json()
    except Exception:
        return {"bpm": None, "err": f"GetSongBPM HTTP {r.status_code}, non-JSON body"}

    if not r.is_success:
        return {"bpm": None, "err": f"GetSongBPM HTTP {r.status_code}", "debug": raw}

    results = (raw or {}).get("search") or []
    if not isinstance(results, list) or not results:
        return {"bpm": None, "debug": raw}

    match = _pick_best(results, artist)
    if not match:
        return {"bpm": None, "debug": raw}

    try:
        return {"bpm": round(float(match["tempo"]))}
    except (ValueError, TypeError):
        return {"bpm": None, "debug": raw}


@router.post("/store", response_model=schemas.TrackBpmOut)
def store_bpm(body: schemas.TrackBpmIn, db: Session = Depends(get_db)):
    existing = db.get(models.TrackBpm, body.spotify_id)
    if existing:
        return existing
    entry = models.TrackBpm(**body.model_dump(), created_at=datetime.utcnow())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry
