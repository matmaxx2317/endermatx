from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from .. import models, schemas
from ..database import get_db

router = APIRouter()

today = datetime.utcnow()
DEFAULT_SETTINGS = {
    "start_year": today.year,
    "start_month": max(today.month - 3, 1),
    "end_year": today.year + 1,
    "end_month": today.month,
    "tile_width": 360,
    "countries": ["DE"],
}


def _get_or_create_settings(db: Session) -> models.CalSettings:
    s = db.get(models.CalSettings, 1)
    if not s:
        s = models.CalSettings(id=1, **DEFAULT_SETTINGS)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


@router.get("/projects", response_model=list[schemas.CalProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return db.query(models.CalProject).order_by(models.CalProject.id).all()


@router.post("/projects", response_model=schemas.CalProjectOut, status_code=201)
def create_project(body: schemas.CalProjectCreate, db: Session = Depends(get_db)):
    proj = models.CalProject(**body.model_dump())
    db.add(proj)
    db.commit()
    db.refresh(proj)
    return proj


@router.put("/projects/{pid}", response_model=schemas.CalProjectOut)
def update_project(pid: int, body: schemas.CalProjectUpdate, db: Session = Depends(get_db)):
    proj = db.get(models.CalProject, pid)
    if not proj:
        raise HTTPException(404)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(proj, k, v)
    db.commit()
    db.refresh(proj)
    return proj


@router.delete("/projects/{pid}", status_code=204)
def delete_project(pid: int, db: Session = Depends(get_db)):
    proj = db.get(models.CalProject, pid)
    if not proj:
        raise HTTPException(404)
    db.delete(proj)
    db.commit()


@router.get("/settings", response_model=schemas.CalSettingsOut)
def get_settings(db: Session = Depends(get_db)):
    return _get_or_create_settings(db)


@router.put("/settings", response_model=schemas.CalSettingsOut)
def update_settings(body: schemas.CalSettingsUpdate, db: Session = Depends(get_db)):
    s = _get_or_create_settings(db)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return s
