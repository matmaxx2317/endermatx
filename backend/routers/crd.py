from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from .. import models, schemas
from ..database import get_db

router = APIRouter()


def _get_or_create(db: Session) -> models.CrdState:
    s = db.get(models.CrdState, 1)
    if not s:
        s = models.CrdState(id=1, lyrics="", manual_chords="", media_url="",
                             chords=[], cursor=0, word_seq=0, lines=[], manual_output=None)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


@router.get("/state", response_model=schemas.CrdStateOut)
def get_state(db: Session = Depends(get_db)):
    return _get_or_create(db)


@router.put("/state", response_model=schemas.CrdStateOut)
def update_state(body: schemas.CrdStateUpdate, db: Session = Depends(get_db)):
    s = _get_or_create(db)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return s
