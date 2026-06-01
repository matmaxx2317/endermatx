from datetime import datetime
from typing import Annotated, Any, Optional
from pydantic import BaseModel, Field
from pydantic.functional_serializers import PlainSerializer

# Timezone-naive datetimes from SQLAlchemy are serialized without a 'Z', so
# browsers interpret them as local time instead of UTC.  These annotated types
# append 'Z' on every JSON response, restoring correct UTC interpretation.
UtcDt    = Annotated[datetime,          PlainSerializer(lambda v: v.isoformat() + 'Z', return_type=str)]
UtcDtOpt = Annotated[Optional[datetime], PlainSerializer(lambda v: v.isoformat() + 'Z' if v else None, return_type=Optional[str])]

_COLOR   = r'^#[0-9a-fA-F]{6}$'   # e.g. #4a9eff
_DATE    = r'^\d{4}-\d{2}-\d{2}$' # e.g. 2026-05-01

# ── tts ───────────────────────────────────────────────────────────────────────

class TtsProjectCreate(BaseModel):
    name:  str = Field(..., max_length=100)
    color: str = Field("#888888", pattern=_COLOR)

class TtsProjectUpdate(BaseModel):
    name:     Optional[str]  = Field(None, max_length=100)
    color:    Optional[str]  = Field(None, pattern=_COLOR)
    archived: Optional[bool] = None

class TtsProjectOut(BaseModel):
    id: int
    name: str
    color: str
    archived: bool
    created_at: UtcDt
    model_config = {"from_attributes": True}


class TtsEntryCreate(BaseModel):
    project_id: int
    start_time: datetime
    end_time: Optional[datetime] = None

class TtsEntryUpdate(BaseModel):
    end_time:   Optional[datetime] = None
    start_time: Optional[datetime] = None
    project_id: Optional[int]      = None

class TtsEntryOut(BaseModel):
    id: int
    project_id: int
    start_time: UtcDt
    end_time: UtcDtOpt
    model_config = {"from_attributes": True}


# ── cal ───────────────────────────────────────────────────────────────────────

_VALID_COUNTRIES = {"DE", "AT", "US", "GB", "FR", "CN", "JP"}

class CalProjectCreate(BaseModel):
    name:       str = Field(..., max_length=100)
    color:      str = Field("#4a9eff", pattern=_COLOR)
    start_date: str = Field(..., pattern=_DATE)
    end_date:   str = Field(..., pattern=_DATE)

class CalProjectUpdate(BaseModel):
    name:       Optional[str] = Field(None, max_length=100)
    color:      Optional[str] = Field(None, pattern=_COLOR)
    start_date: Optional[str] = Field(None, pattern=_DATE)
    end_date:   Optional[str] = Field(None, pattern=_DATE)

class CalProjectOut(BaseModel):
    id: int
    name: str
    color: str
    start_date: str
    end_date: str
    model_config = {"from_attributes": True}


class CalSettingsUpdate(BaseModel):
    start_year:  Optional[int]       = Field(None, ge=2000, le=2100)
    start_month: Optional[int]       = Field(None, ge=0,    le=11)
    end_year:    Optional[int]       = Field(None, ge=2000, le=2100)
    end_month:   Optional[int]       = Field(None, ge=0,    le=11)
    tile_width:  Optional[int]       = Field(None, ge=100,  le=1200)
    countries:   Optional[list[str]] = None

    def model_post_init(self, __context: Any) -> None:
        if self.countries is not None:
            invalid = [c for c in self.countries if c not in _VALID_COUNTRIES]
            if invalid:
                raise ValueError(f"unknown country codes: {invalid}")

class CalSettingsOut(BaseModel):
    start_year:  Optional[int]
    start_month: Optional[int]
    end_year:    Optional[int]
    end_month:   Optional[int]
    tile_width:  int
    countries:   list[str]
    model_config = {"from_attributes": True}


# ── idx ───────────────────────────────────────────────────────────────────────

_VALID_STATUSES = {"inbox", "promoted", "deferred", "done", "killed"}

class IdeaCreate(BaseModel):
    text: str = Field(..., max_length=500)

class IdeaUpdate(BaseModel):
    text:   Optional[str] = Field(None, max_length=500)
    status: Optional[str] = None

    def model_post_init(self, __context: Any) -> None:
        if self.status is not None and self.status not in _VALID_STATUSES:
            raise ValueError(f"invalid status")

class IdeaOut(BaseModel):
    id: int
    text: str
    status: str
    rank: Optional[int] = None
    created_at: UtcDt
    updated_at: UtcDt
    model_config = {"from_attributes": True}

class IdeaReorder(BaseModel):
    ids: list[int]


# ── str ───────────────────────────────────────────────────────────────────────

class GuitarCreate(BaseModel):
    name:           str = Field(..., max_length=100)
    threshold_days: int = Field(30, ge=1, le=3650)

class GuitarUpdate(BaseModel):
    name:           Optional[str] = Field(None, max_length=100)
    threshold_days: Optional[int] = Field(None, ge=1, le=3650)

class GuitarChangeCreate(BaseModel):
    changed_at: Optional[datetime] = None

class GuitarOut(BaseModel):
    id: int
    name: str
    threshold_days: int
    last_changed: UtcDtOpt
    history: list[str]
    model_config = {"from_attributes": True}


# ── spt ───────────────────────────────────────────────────────────────────────

class TrackBpmIn(BaseModel):
    spotify_id: str
    title:      str
    artist:     str
    album:      str = ""
    bpm:        int
    source:     str

class TrackBpmOut(TrackBpmIn):
    created_at: UtcDt
    model_config = {"from_attributes": True}

class BatchLookupRequest(BaseModel):
    spotify_ids: list[str]


# ── wmt ───────────────────────────────────────────────────────────────────────

class WmtTeamOut(BaseModel):
    id: int
    api_id: Optional[int]
    name: str
    short_name: Optional[str]
    tla: Optional[str]
    elo: float
    matches_played: int
    model_config = {"from_attributes": True}


class WmtPredictionOut(BaseModel):
    id: int
    match_id: int
    created_at: UtcDt
    home_win_prob: float
    draw_prob: float
    away_win_prob: float
    pred_home_goals: float
    pred_away_goals: float
    home_elo: Optional[float]
    away_elo: Optional[float]
    reasoning: Optional[str]
    model_config = {"from_attributes": True}


class WmtMatchOut(BaseModel):
    id: int
    api_id: Optional[int]
    matchday: int
    stage: str
    group_name: Optional[str]
    utc_date: UtcDt
    status: str
    score_home: Optional[int]
    score_away: Optional[int]
    home_team: Optional[WmtTeamOut]
    away_team: Optional[WmtTeamOut]
    prediction: Optional[WmtPredictionOut]


class WmtSummaryOut(BaseModel):
    id: int
    date: str
    content: str
    matches_count: int
    created_at: UtcDt
    model_config = {"from_attributes": True}


class WmtRefreshOut(BaseModel):
    message: str
    updated: int


class WmtBonusPredictionOut(BaseModel):
    id: int
    generated_at: UtcDt
    group_winners: Any
    semifinalists: Any
    finalists: Any
    winner: Any
    top_scorer: Any
    n_simulations: int
    model_config = {"from_attributes": True}


class WmtWarmupOut(BaseModel):
    message: str
    logs: list[dict]
    competitions_processed: int
    matches_processed: int
    teams_updated: int
    elapsed_seconds: float


class WmtStatusOut(BaseModel):
    match_count: int
    team_count: int
    prediction_count: int
    calibrated: bool

