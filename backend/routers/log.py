from fastapi import APIRouter, Depends
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


@router.get("", response_model=list[schemas.SchedulerLogOut])
@router.get("/", response_model=list[schemas.SchedulerLogOut])
def list_logs(limit: int = 500, db: Session = Depends(get_db)):
    """Scheduler run log, most recent run first."""
    return (
        db.query(models.SchedulerLog)
        .order_by(models.SchedulerLog.ran_at.desc())
        .limit(limit)
        .all()
    )
