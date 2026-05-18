import asyncio
import os
import time
from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..database import SessionLocal
from .. import models
from .bpm import _clean_title, _getsong_results, _pick_best, _deezer_search, _pick_deezer

router = APIRouter()

# ── In-memory scan state (cleared on server restart) ──────────────────────────

_state: dict[str, Any] = {
    "status":          "idle",   # idle | running | done
    "tracks_total":    0,
    "tracks_done":     0,
    "playlists_total": 0,
    "playlists_done":  0,
    "started_at":      None,
    "finished_at":     None,
    "log":             [],       # [{source, name, bpm, err?}]
}

_GETSONG_DELAY = 0.4   # seconds between getsong.co calls
_DEEZER_DELAY  = 0.4   # seconds before Deezer fallback


class ScanTrack(BaseModel):
    spotify_id: str
    name: str
    artist: str
    album: str = ""
    spotify_bpm: int | None = None


class ScanStartRequest(BaseModel):
    tracks: list[ScanTrack]
    playlists_total: int = 0
    playlists_done: int = 0


def _append_log(name: str, artist: str, bpm, **sources) -> None:
    entry: dict[str, Any] = {"name": name, "artist": artist, "bpm": bpm}
    entry.update(sources)
    _state["log"].append(entry)


def _store_bpm_db(track: ScanTrack, bpm: int, source: str) -> None:
    db = SessionLocal()
    try:
        existing = db.get(models.TrackBpm, track.spotify_id)
        if existing:
            if existing.source == "not_found" and source != "not_found":
                existing.bpm    = bpm
                existing.source = source
                existing.title  = track.name
                existing.artist = track.artist
                db.commit()
        else:
            db.add(models.TrackBpm(
                spotify_id = track.spotify_id,
                title      = track.name,
                artist     = track.artist,
                album      = track.album,
                bpm        = bpm,
                source     = source,
                created_at = datetime.utcnow(),
            ))
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _do_scan(tracks: list[ScanTrack]) -> None:
    """Resolve BPMs for all tracks. Runs in a thread pool via asyncio.to_thread."""
    api_key = os.getenv("GETSONGBPM_API_KEY", "")

    # Batch-check DB — skip tracks already resolved with a real source
    db = SessionLocal()
    try:
        ids = [t.spotify_id for t in tracks]
        cached_ids = {
            r.spotify_id
            for r in db.query(models.TrackBpm).filter(
                models.TrackBpm.spotify_id.in_(ids),
                models.TrackBpm.source != "not_found",
            ).all()
        }
    finally:
        db.close()

    to_resolve = [t for t in tracks if t.spotify_id not in cached_ids]
    _state["tracks_done"] = len(cached_ids)

    need_delay = False  # only delay before getsong.co/Deezer calls

    for track in to_resolve:

        # Tier 0: Spotify Audio Features (pre-fetched by the browser, no external call)
        if track.spotify_bpm:
            _append_log(track.name, track.artist, track.spotify_bpm, spotify="pass")
            _store_bpm_db(track, track.spotify_bpm, "spotify")
            _state["tracks_done"] += 1
            continue

        # Tier 2: getsong.co (rate-limited)
        if need_delay:
            time.sleep(_GETSONG_DELAY)
        need_delay = True
        bpm = None
        if api_key:
            results = _getsong_results(api_key, track.name)
            cleaned = _clean_title(track.name)
            if not results and cleaned != track.name:
                results = _getsong_results(api_key, cleaned)
            match = _pick_best(results, track.artist) if results else None
            if match:
                try:
                    bpm = round(float(match["tempo"]))
                except (ValueError, TypeError):
                    bpm = None

        if bpm:
            _append_log(track.name, track.artist, bpm, getsongbpm="pass")
            _store_bpm_db(track, bpm, "getsongbpm")
        else:
            # Tier 3: Deezer
            time.sleep(_DEEZER_DELAY)
            results = _deezer_search(track.name, track.artist)
            if not results:
                cleaned = _clean_title(track.name)
                if cleaned != track.name:
                    results = _deezer_search(cleaned, track.artist)

            deezer_bpm = None
            if results:
                deezer_track = _pick_deezer(results, track.artist)
                if deezer_track:
                    try:
                        r = httpx.get(
                            f"https://api.deezer.com/track/{deezer_track['id']}",
                            headers={"User-Agent": "endermatx/1.0 (https://matmaxx.org)"},
                            timeout=10,
                        )
                        if r.is_success:
                            val_raw = r.json().get("bpm")
                            if val_raw:
                                val = round(float(val_raw))
                                if val > 0:
                                    deezer_bpm = val
                    except Exception:
                        pass

            if deezer_bpm:
                _append_log(track.name, track.artist, deezer_bpm, getsongbpm="fail", deezer="pass")
                _store_bpm_db(track, deezer_bpm, "deezer")
            else:
                _append_log(track.name, track.artist, None, getsongbpm="fail", deezer="fail")
                _store_bpm_db(track, 0, "not_found")

        _state["tracks_done"] += 1


    _state["status"]      = "done"
    _state["finished_at"] = datetime.utcnow().isoformat() + "Z"


@router.post("/start")
async def scan_start(body: ScanStartRequest):
    if _state["status"] == "running":
        raise HTTPException(409, "Scan already running")
    _state.update({
        "status":          "running",
        "tracks_total":    len(body.tracks),
        "tracks_done":     0,
        "playlists_total": body.playlists_total,
        "playlists_done":  body.playlists_done,
        "started_at":      datetime.utcnow().isoformat() + "Z",
        "finished_at":     None,
        "log":             [],
    })
    asyncio.create_task(asyncio.to_thread(_do_scan, list(body.tracks)))
    return {"status": "started", "tracks": len(body.tracks)}


@router.get("/status")
def scan_status(since: int = Query(0, ge=0), last: int = Query(0, ge=0)):
    log = _state["log"]
    if last > 0:
        log_slice = log[-last:] if len(log) >= last else log[:]
    else:
        log_slice = log[since: since + 200]
    return {
        "status":          _state["status"],
        "tracks_total":    _state["tracks_total"],
        "tracks_done":     _state["tracks_done"],
        "playlists_total": _state["playlists_total"],
        "playlists_done":  _state["playlists_done"],
        "started_at":      _state["started_at"],
        "finished_at":     _state["finished_at"],
        "log":             log_slice,
        "log_count":       len(log),
    }
