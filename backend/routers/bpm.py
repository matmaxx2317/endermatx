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


@router.get("/getsongbpm")
def getsongbpm_lookup(title: str = Query(...), artist: str = Query(...)):
    api_key = os.getenv("GETSONGBPM_API_KEY", "")
    if not api_key:
        raise HTTPException(503, "GetSongBPM not configured")

    query = f"{title} {artist}"
    try:
        r = httpx.get(
            "https://api.getsongbpm.com/search/",
            params={"api_key": api_key, "type": "both", "lookup": query},
            timeout=10,
        )
    except httpx.TimeoutException:
        raise HTTPException(504, "GetSongBPM timeout")
    except Exception:
        return {"bpm": None}

    raw = None
    try:
        raw = r.json()
    except Exception:
        return {"bpm": None, "debug": f"HTTP {r.status_code}, non-JSON body"}

    if not r.is_success:
        return {"bpm": None, "debug": raw}

    results = (raw or {}).get("search") or []
    if not results:
        return {"bpm": None, "debug": raw}

    tempo = results[0].get("tempo")
    if not tempo:
        return {"bpm": None, "debug": raw}

    try:
        return {"bpm": round(float(tempo))}
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
