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


def _getsongbpm_request(api_key: str, query: str):
    app_url = os.getenv("GETSONGBPM_APP_URL", "https://matmaxx.org/spt")
    return httpx.get(
        "https://api.getsong.co/search/",
        params={"api_key": api_key, "type": "song_name", "lookup": query},
        headers={
            "Referer": app_url,
            "Origin":  app_url,
            "User-Agent": "Mozilla/5.0 (compatible; endermatx/1.0)",
        },
        timeout=10,
    )


@router.get("/getsongbpm")
def getsongbpm_lookup(title: str = Query(...), artist: str = Query(...)):
    api_key = os.getenv("GETSONGBPM_API_KEY", "")
    if not api_key:
        raise HTTPException(503, "GetSongBPM not configured")

    query = f"{title} {artist}"
    try:
        r = _getsongbpm_request(api_key, query)
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
    if not results:
        return {"bpm": None, "debug": raw}

    tempo = results[0].get("tempo")
    if not tempo:
        return {"bpm": None, "debug": raw}

    try:
        return {"bpm": round(float(tempo))}
    except (ValueError, TypeError):
        return {"bpm": None, "debug": raw}


@router.get("/test")
def getsongbpm_test():
    """Probe multiple type values to find which one getsong.co accepts."""
    api_key = os.getenv("GETSONGBPM_API_KEY", "")
    if not api_key:
        return {"error": "GETSONGBPM_API_KEY not set"}

    app_url = os.getenv("GETSONGBPM_APP_URL", "https://matmaxx.org/spt")
    headers = {
        "Referer":    app_url,
        "Origin":     app_url,
        "User-Agent": "Mozilla/5.0 (compatible; endermatx/1.0)",
    }

    probes = [
        {"type": "song",       "lookup": "Never Gonna Give You Up Rick Astley"},
        {"type": "song",       "lookup": "Never Gonna Give You Up"},
        {"type": "both",       "lookup": "Never Gonna Give You Up Rick Astley"},
        {"type": "artist",     "lookup": "Rick Astley"},
        {"type": "song_name",  "lookup": "Never Gonna Give You Up"},
    ]

    results = []
    for p in probes:
        try:
            r = httpx.get(
                "https://api.getsong.co/search/",
                params={"api_key": api_key, **p},
                headers=headers,
                timeout=10,
            )
            try:
                body = r.json()
            except Exception:
                body = r.text
            results.append({"params": p, "status": r.status_code, "body": body})
        except Exception as e:
            results.append({"params": p, "error": str(e)})

    return results


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
