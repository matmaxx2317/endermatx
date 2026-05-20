from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from .. import models, schemas
from ..database import get_db

router = APIRouter()

VALID_STATUSES = {"inbox", "promoted", "deferred", "done", "killed"}


@router.get("/ideas", response_model=list[schemas.IdeaOut])
def list_ideas(db: Session = Depends(get_db)):
    return db.query(models.Idea).order_by(models.Idea.created_at.desc()).all()


@router.post("/ideas", response_model=schemas.IdeaOut, status_code=201)
def create_idea(body: schemas.IdeaCreate, db: Session = Depends(get_db)):
    idea = models.Idea(text=body.text)
    db.add(idea)
    db.commit()
    db.refresh(idea)
    return idea


@router.put("/ideas/{iid}", response_model=schemas.IdeaOut)
def update_idea(iid: int, body: schemas.IdeaUpdate, db: Session = Depends(get_db)):
    idea = db.get(models.Idea, iid)
    if not idea:
        raise HTTPException(404)
    if body.status and body.status not in VALID_STATUSES:
        raise HTTPException(400, f"invalid status: {body.status}")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(idea, k, v)
    idea.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(idea)
    return idea


@router.put("/ideas/reorder", response_model=list[schemas.IdeaOut])
def reorder_ideas(body: schemas.IdeaReorder, db: Session = Depends(get_db)):
    for rank, iid in enumerate(body.ids):
        idea = db.get(models.Idea, iid)
        if idea:
            idea.rank = rank
    db.commit()
    return (
        db.query(models.Idea)
        .filter(models.Idea.id.in_(body.ids))
        .order_by(models.Idea.rank)
        .all()
    )


@router.delete("/ideas/{iid}", status_code=204)
def delete_idea(iid: int, db: Session = Depends(get_db)):
    idea = db.get(models.Idea, iid)
    if not idea:
        raise HTTPException(404)
    db.delete(idea)
    db.commit()
