from datetime import datetime
from sqlalchemy import BigInteger, Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String
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
    rank = Column(Integer, nullable=True)
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


# ── wmt ───────────────────────────────────────────────────────────────────────

class WmtTeam(Base):
    __tablename__ = "wmt_teams"
    id             = Column(Integer, primary_key=True, autoincrement=True)
    api_id         = Column(Integer, nullable=True, unique=True)
    name           = Column(String, nullable=False)
    short_name     = Column(String, nullable=True)
    tla            = Column(String(5), nullable=True)
    elo            = Column(Float, default=1700.0)
    matches_played = Column(Integer, default=0)


class WmtMatch(Base):
    __tablename__ = "wmt_matches"
    id           = Column(Integer, primary_key=True, autoincrement=True)
    api_id       = Column(Integer, nullable=True, unique=True)
    matchday     = Column(Integer, nullable=False)
    stage        = Column(String, nullable=False)
    group_name   = Column(String(10), nullable=True)
    utc_date     = Column(DateTime, nullable=False)
    home_team_id = Column(Integer, ForeignKey("wmt_teams.id"), nullable=True)
    away_team_id = Column(Integer, ForeignKey("wmt_teams.id"), nullable=True)
    status       = Column(String, default="SCHEDULED")
    score_home   = Column(Integer, nullable=True)
    score_away   = Column(Integer, nullable=True)
    last_fetched = Column(DateTime, nullable=True)


class WmtPrediction(Base):
    __tablename__ = "wmt_predictions"
    id              = Column(Integer, primary_key=True, autoincrement=True)
    match_id        = Column(Integer, ForeignKey("wmt_matches.id"), nullable=False)
    created_at      = Column(DateTime, default=datetime.utcnow)
    home_win_prob   = Column(Float, nullable=False)
    draw_prob       = Column(Float, nullable=False)
    away_win_prob   = Column(Float, nullable=False)
    pred_home_goals = Column(Float, nullable=False)
    pred_away_goals = Column(Float, nullable=False)
    home_elo        = Column(Float, nullable=True)
    away_elo        = Column(Float, nullable=True)
    reasoning       = Column(String, nullable=True)


class WmtSummary(Base):
    __tablename__ = "wmt_summaries"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    date          = Column(Date, nullable=False, unique=True)
    content       = Column(String, nullable=False)
    matches_count = Column(Integer, default=0)
    created_at    = Column(DateTime, default=datetime.utcnow)
