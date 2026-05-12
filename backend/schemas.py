from datetime import datetime
from typing import Annotated, Any, Optional
from pydantic import BaseModel
from pydantic.functional_serializers import PlainSerializer

# Timezone-naive datetimes from SQLAlchemy are serialized without a 'Z', so
# browsers interpret them as local time instead of UTC.  These annotated types
# append 'Z' on every JSON response, restoring correct UTC interpretation.
UtcDt    = Annotated[datetime,          PlainSerializer(lambda v: v.isoformat() + 'Z', return_type=str)]
UtcDtOpt = Annotated[Optional[datetime], PlainSerializer(lambda v: v.isoformat() + 'Z' if v else None, return_type=Optional[str])]


# ── tts ───────────────────────────────────────────────────────────────────────

class TtsProjectCreate(BaseModel):
    name: str
    color: str = "#888888"

class TtsProjectUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
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
    end_time: Optional[datetime] = None
    start_time: Optional[datetime] = None
    project_id: Optional[int] = None

class TtsEntryOut(BaseModel):
    id: int
    project_id: int
    start_time: UtcDt
    end_time: UtcDtOpt
    model_config = {"from_attributes": True}


# ── cal ───────────────────────────────────────────────────────────────────────

class CalProjectCreate(BaseModel):
    name: str
    color: str = "#4a9eff"
    start_date: str
    end_date: str

class CalProjectUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None

class CalProjectOut(BaseModel):
    id: int
    name: str
    color: str
    start_date: str
    end_date: str
    model_config = {"from_attributes": True}


class CalSettingsUpdate(BaseModel):
    start_year: Optional[int] = None
    start_month: Optional[int] = None
    end_year: Optional[int] = None
    end_month: Optional[int] = None
    tile_width: Optional[int] = None
    countries: Optional[list[str]] = None

class CalSettingsOut(BaseModel):
    start_year: Optional[int]
    start_month: Optional[int]
    end_year: Optional[int]
    end_month: Optional[int]
    tile_width: int
    countries: list[str]
    model_config = {"from_attributes": True}


# ── pom ───────────────────────────────────────────────────────────────────────

class PomStateUpdate(BaseModel):
    sessions: Optional[dict[str, Any]] = None
    total_mins: Optional[float] = None
    timer: Optional[dict[str, Any]] = None

class PomStateOut(BaseModel):
    sessions: dict[str, Any]
    total_mins: float
    timer: Optional[dict[str, Any]]
    model_config = {"from_attributes": True}


# ── mtg ───────────────────────────────────────────────────────────────────────

class MeetingCreate(BaseModel):
    title: str
    date: str = ""
    notes: str = ""
    attendees: list[str] = []
    actions: list[dict[str, Any]] = []
    summary: str = ""

class MeetingUpdate(BaseModel):
    title: Optional[str] = None
    date: Optional[str] = None
    notes: Optional[str] = None
    attendees: Optional[list[str]] = None
    actions: Optional[list[dict[str, Any]]] = None
    summary: Optional[str] = None

class MeetingOut(BaseModel):
    id: int
    title: str
    date: str
    notes: str
    attendees: list[str]
    actions: list[dict[str, Any]]
    summary: str
    created_at: UtcDt
    model_config = {"from_attributes": True}


# ── idx ───────────────────────────────────────────────────────────────────────

class IdeaCreate(BaseModel):
    text: str

class IdeaUpdate(BaseModel):
    text: Optional[str] = None
    status: Optional[str] = None

class IdeaOut(BaseModel):
    id: int
    text: str
    status: str
    created_at: UtcDt
    updated_at: UtcDt
    model_config = {"from_attributes": True}


# ── str ───────────────────────────────────────────────────────────────────────

class GuitarCreate(BaseModel):
    name: str
    threshold_days: int = 30

class GuitarUpdate(BaseModel):
    name: Optional[str] = None
    threshold_days: Optional[int] = None

class GuitarOut(BaseModel):
    id: int
    name: str
    threshold_days: int
    last_changed: UtcDtOpt
    history: list[str]
    model_config = {"from_attributes": True}


# ── crd ───────────────────────────────────────────────────────────────────────

class CrdStateUpdate(BaseModel):
    lyrics: Optional[str] = None
    manual_chords: Optional[str] = None
    media_url: Optional[str] = None
    chords: Optional[list[Any]] = None
    cursor: Optional[int] = None
    word_seq: Optional[int] = None
    lines: Optional[list[Any]] = None
    manual_output: Optional[str] = None

class CrdStateOut(BaseModel):
    lyrics: str
    manual_chords: str
    media_url: str
    chords: list[Any]
    cursor: int
    word_seq: int
    lines: list[Any]
    manual_output: Optional[str]
    model_config = {"from_attributes": True}
