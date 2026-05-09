from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from .. import models, schemas
from ..database import get_db

router = APIRouter()


@router.get("/projects", response_model=list[schemas.TtsProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return db.query(models.TtsProject).order_by(models.TtsProject.created_at).all()


@router.post("/projects", response_model=schemas.TtsProjectOut, status_code=201)
def create_project(body: schemas.TtsProjectCreate, db: Session = Depends(get_db)):
    proj = models.TtsProject(**body.model_dump())
    db.add(proj)
    db.commit()
    db.refresh(proj)
    return proj


@router.put("/projects/{pid}", response_model=schemas.TtsProjectOut)
def update_project(pid: int, body: schemas.TtsProjectUpdate, db: Session = Depends(get_db)):
    proj = db.get(models.TtsProject, pid)
    if not proj:
        raise HTTPException(404)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(proj, k, v)
    db.commit()
    db.refresh(proj)
    return proj


@router.delete("/projects/{pid}", status_code=204)
def delete_project(pid: int, db: Session = Depends(get_db)):
    proj = db.get(models.TtsProject, pid)
    if not proj:
        raise HTTPException(404)
    db.delete(proj)
    db.commit()


@router.get("/entries", response_model=list[schemas.TtsEntryOut])
def list_entries(project_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(models.TtsEntry)
    if project_id is not None:
        q = q.filter(models.TtsEntry.project_id == project_id)
    return q.order_by(models.TtsEntry.start_time.desc()).all()


@router.post("/entries", response_model=schemas.TtsEntryOut, status_code=201)
def create_entry(body: schemas.TtsEntryCreate, db: Session = Depends(get_db)):
    entry = models.TtsEntry(**body.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.put("/entries/{eid}", response_model=schemas.TtsEntryOut)
def update_entry(eid: int, body: schemas.TtsEntryUpdate, db: Session = Depends(get_db)):
    entry = db.get(models.TtsEntry, eid)
    if not entry:
        raise HTTPException(404)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(entry, k, v)
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/entries/{eid}", status_code=204)
def delete_entry(eid: int, db: Session = Depends(get_db)):
    entry = db.get(models.TtsEntry, eid)
    if not entry:
        raise HTTPException(404)
    db.delete(entry)
    db.commit()
