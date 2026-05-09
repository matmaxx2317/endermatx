from datetime import datetime
from sqlalchemy import BigInteger, Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from .database import Base


# ── tts ───────────────────────────────────────────────────────────────────────

class TtsProject(Base):
    __tablename__ = "tts_projects"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    color = Column(String, nullable=False, default="#888888")
    archived = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class TtsEntry(Base):
    __tablename__ = "tts_entries"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    project_id = Column(BigInteger, ForeignKey("tts_projects.id", ondelete="CASCADE"), nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=True)


# ── cal ───────────────────────────────────────────────────────────────────────

class CalProject(Base):
    __tablename__ = "cal_projects"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    color = Column(String, nullable=False, default="#4a9eff")
    start_date = Column(String, nullable=False)
    end_date = Column(String, nullable=False)


class CalSettings(Base):
    __tablename__ = "cal_settings"
    id = Column(Integer, primary_key=True, default=1)
    start_year = Column(Integer)
    start_month = Column(Integer)
    end_year = Column(Integer)
    end_month = Column(Integer)
    tile_width = Column(Integer, default=360)
    countries = Column(JSONB, default=list)


# ── pom ───────────────────────────────────────────────────────────────────────

class PomState(Base):
    __tablename__ = "pom_state"
    id = Column(Integer, primary_key=True, default=1)
    sessions = Column(JSONB, default=dict)
    total_mins = Column(Float, default=0.0)
    timer = Column(JSONB, nullable=True)


# ── mtg ───────────────────────────────────────────────────────────────────────

class Meeting(Base):
    __tablename__ = "mtg_meetings"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    title = Column(String, nullable=False)
    date = Column(String, default="")
    notes = Column(Text, default="")
    attendees = Column(JSONB, default=list)
    actions = Column(JSONB, default=list)
    summary = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


# ── idx ───────────────────────────────────────────────────────────────────────

class Idea(Base):
    __tablename__ = "idx_ideas"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    text = Column(String, nullable=False)
    status = Column(String, default="inbox")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)


# ── str ───────────────────────────────────────────────────────────────────────

class Guitar(Base):
    __tablename__ = "str_guitars"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    threshold_days = Column(Integer, default=30)
    last_changed = Column(DateTime, nullable=True)
    history = Column(JSONB, default=list)


# ── crd ───────────────────────────────────────────────────────────────────────

class CrdState(Base):
    __tablename__ = "crd_state"
    id = Column(Integer, primary_key=True, default=1)
    lyrics = Column(Text, default="")
    manual_chords = Column(Text, default="")
    media_url = Column(String, default="")
    chords = Column(JSONB, default=list)
    cursor = Column(Integer, default=0)
    word_seq = Column(Integer, default=0)
    lines = Column(JSONB, default=list)
    manual_output = Column(Text, nullable=True)
