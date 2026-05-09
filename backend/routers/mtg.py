from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from .. import models, schemas
from ..database import get_db

router = APIRouter()


@router.get("/meetings", response_model=list[schemas.MeetingOut])
def list_meetings(db: Session = Depends(get_db)):
    return db.query(models.Meeting).order_by(models.Meeting.date.desc(), models.Meeting.created_at.desc()).all()


@router.post("/meetings", response_model=schemas.MeetingOut, status_code=201)
def create_meeting(body: schemas.MeetingCreate, db: Session = Depends(get_db)):
    mtg = models.Meeting(**body.model_dump())
    db.add(mtg)
    db.commit()
    db.refresh(mtg)
    return mtg


@router.put("/meetings/{mid}", response_model=schemas.MeetingOut)
def update_meeting(mid: int, body: schemas.MeetingUpdate, db: Session = Depends(get_db)):
    mtg = db.get(models.Meeting, mid)
    if not mtg:
        raise HTTPException(404)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(mtg, k, v)
    db.commit()
    db.refresh(mtg)
    return mtg


@router.delete("/meetings/{mid}", status_code=204)
def delete_meeting(mid: int, db: Session = Depends(get_db)):
    mtg = db.get(models.Meeting, mid)
    if not mtg:
        raise HTTPException(404)
    db.delete(mtg)
    db.commit()
