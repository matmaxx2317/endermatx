from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
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


def _active_ride(db: Session) -> models.DrvRide | None:
    return (
        db.query(models.DrvRide)
        .filter(models.DrvRide.ended_at.is_(None))
        .order_by(models.DrvRide.started_at.desc())
        .first()
    )


def _serialize(ride: models.DrvRide) -> dict:
    """Build the API view, computing the in-progress segment from seg_start so
    the client can tick locally from this baseline without clock-skew issues."""
    active = ride.ended_at is None
    seg_ms = 0
    if active and ride.seg_start is not None:
        seg_ms = max(0, int((datetime.utcnow() - ride.seg_start).total_seconds() * 1000))
    return {
        "id": ride.id,
        "active": active,
        "mode": ride.mode,
        "drive_ms": ride.drive_ms,
        "wait_ms": ride.wait_ms,
        "alternations": ride.alternations,
        "current_segment_ms": seg_ms,
        "started_at": ride.started_at,
        "ended_at": ride.ended_at,
    }


def _commit_segment(ride: models.DrvRide, now: datetime) -> None:
    """Fold the elapsed time of the current segment into its accumulator."""
    if ride.mode is None or ride.seg_start is None:
        return
    elapsed = max(0, int((now - ride.seg_start).total_seconds() * 1000))
    if ride.mode == "drive":
        ride.drive_ms += elapsed
    else:
        ride.wait_ms += elapsed


@router.get("/ride/active", response_model=schemas.DrvRideOut | None)
def get_active(db: Session = Depends(get_db)):
    ride = _active_ride(db)
    return _serialize(ride) if ride else None


@router.post("/ride/start", response_model=schemas.DrvRideOut)
def start_ride(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    # abandon any ride still open (e.g. never stopped) before starting fresh
    for stale in db.query(models.DrvRide).filter(models.DrvRide.ended_at.is_(None)).all():
        stale.ended_at = now
    ride = models.DrvRide(
        started_at=now, ended_at=None,
        drive_ms=0, wait_ms=0,
        mode="drive", seg_start=now,   # a new ride always starts in drive mode
        alternations=0,
    )
    db.add(ride)
    db.commit()
    db.refresh(ride)
    return _serialize(ride)


@router.post("/ride/mode", response_model=schemas.DrvRideOut)
def set_mode(body: schemas.DrvModeIn, db: Session = Depends(get_db)):
    ride = _active_ride(db)
    if not ride:
        raise HTTPException(404, "no active ride")
    now = datetime.utcnow()
    _commit_segment(ride, now)
    if ride.mode != body.mode:
        ride.alternations += 1
    ride.mode = body.mode
    ride.seg_start = now
    db.commit()
    db.refresh(ride)
    return _serialize(ride)


@router.post("/ride/stop", response_model=schemas.DrvRideOut)
def stop_ride(db: Session = Depends(get_db)):
    ride = _active_ride(db)
    if not ride:
        raise HTTPException(404, "no active ride")
    now = datetime.utcnow()
    _commit_segment(ride, now)
    ride.ended_at = now
    ride.mode = None
    ride.seg_start = None
    db.commit()
    db.refresh(ride)
    return _serialize(ride)
