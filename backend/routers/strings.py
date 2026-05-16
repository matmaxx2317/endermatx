from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from .. import models, schemas
from ..database import get_db

router = APIRouter()


@router.get("/guitars", response_model=list[schemas.GuitarOut])
def list_guitars(db: Session = Depends(get_db)):
    return db.query(models.Guitar).order_by(models.Guitar.id).all()


@router.post("/guitars", response_model=schemas.GuitarOut, status_code=201)
def create_guitar(body: schemas.GuitarCreate, db: Session = Depends(get_db)):
    guitar = models.Guitar(**body.model_dump(), history=[])
    db.add(guitar)
    db.commit()
    db.refresh(guitar)
    return guitar


@router.put("/guitars/{gid}", response_model=schemas.GuitarOut)
def update_guitar(gid: int, body: schemas.GuitarUpdate, db: Session = Depends(get_db)):
    guitar = db.get(models.Guitar, gid)
    if not guitar:
        raise HTTPException(404)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(guitar, k, v)
    db.commit()
    db.refresh(guitar)
    return guitar


@router.delete("/guitars/{gid}", status_code=204)
def delete_guitar(gid: int, db: Session = Depends(get_db)):
    guitar = db.get(models.Guitar, gid)
    if not guitar:
        raise HTTPException(404)
    db.delete(guitar)
    db.commit()


@router.post("/guitars/{gid}/change", response_model=schemas.GuitarOut)
def record_change(gid: int, body: schemas.GuitarChangeCreate, db: Session = Depends(get_db)):
    guitar = db.get(models.Guitar, gid)
    if not guitar:
        raise HTTPException(404)
    ts = body.changed_at if body.changed_at else datetime.utcnow()
    history = list(guitar.history or [])
    history.append(ts.isoformat())
    guitar.history = history
    guitar.last_changed = ts
    db.commit()
    db.refresh(guitar)
    return guitar


@router.delete("/guitars/{gid}/change", response_model=schemas.GuitarOut)
def undo_change(gid: int, db: Session = Depends(get_db)):
    guitar = db.get(models.Guitar, gid)
    if not guitar:
        raise HTTPException(404)
    history = list(guitar.history or [])
    if history:
        history.pop()
    guitar.history = history
    guitar.last_changed = datetime.fromisoformat(history[-1]) if history else None
    db.commit()
    db.refresh(guitar)
    return guitar
