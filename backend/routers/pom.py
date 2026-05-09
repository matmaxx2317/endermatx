from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from .. import models, schemas
from ..database import get_db

router = APIRouter()


def _get_or_create(db: Session) -> models.PomState:
    s = db.get(models.PomState, 1)
    if not s:
        s = models.PomState(id=1, sessions={}, total_mins=0.0, timer=None)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


@router.get("/state", response_model=schemas.PomStateOut)
def get_state(db: Session = Depends(get_db)):
    return _get_or_create(db)


@router.put("/state", response_model=schemas.PomStateOut)
def update_state(body: schemas.PomStateUpdate, db: Session = Depends(get_db)):
    s = _get_or_create(db)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return s
