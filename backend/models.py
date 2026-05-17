from datetime import datetime
from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, String
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


# ── spt ───────────────────────────────────────────────────────────────────────

class TrackBpm(Base):
    __tablename__ = "spt_track_bpm"
    spotify_id = Column(String, primary_key=True)
    title      = Column(String, nullable=False)
    artist     = Column(String, nullable=False)
    album      = Column(String, nullable=False, default="")
    bpm        = Column(Integer, nullable=False)
    source     = Column(String, nullable=False)   # 'getsongbpm' | 'audio'
    created_at = Column(DateTime, default=datetime.utcnow)


