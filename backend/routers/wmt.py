"""
WMT – WM 2026 Tipp-Assistent
Spielplan: football-data.org v4 (API-Key nötig, alle 104 Spiele)
           → Fallback: openligadb.de (kein Key, nur 1. Spieltag)
Kalibrierung: openligadb.de historische Turniere (kein API-Key)
Prognosemodell: ELO-basierte Siegwahrscheinlichkeiten + erwartete Tore
"""

import logging
import math
import os
import random
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

logger = logging.getLogger(__name__)
router = APIRouter()

ELO_K        = 60      # WC-Turnier-K-Faktor
WC_AVG_GOALS = 1.35    # Ø Tore pro Team pro WC-Spiel


# Initial ELO estimates for WC 2026 participants (calibrated ~June 2026)
INITIAL_ELO: dict[str, float] = {
    "ARG": 2090, "FRA": 2020, "BRA": 2000, "ESP": 1980, "ENG": 1960,
    "POR": 1940, "NED": 1900, "GER": 1890, "BEL": 1880, "ITA": 1870,
    "MAR": 1860, "CRO": 1850, "JPN": 1840, "USA": 1830, "MEX": 1820,
    "COL": 1810, "URU": 1800, "SUI": 1800, "DEN": 1790, "UKR": 1790,
    "AUT": 1780, "SEN": 1780, "KOR": 1780, "TUR": 1770, "CAN": 1770,
    "CZE": 1760, "SCO": 1760, "WAL": 1750, "NGA": 1750, "CIV": 1740,
    "SRB": 1740, "HUN": 1740, "POL": 1730, "ROU": 1730, "EGY": 1720,
    "IRN": 1720, "GRE": 1720, "ECU": 1710, "AUS": 1710, "SVK": 1740,
    "CMR": 1700, "ALG": 1700, "GHA": 1700, "SAU": 1680, "PAN": 1680,
    "VEN": 1680, "PAR": 1680, "ALB": 1680, "JOR": 1680, "IRQ": 1670,
    "UZB": 1650, "CRC": 1660, "RSA": 1660, "TUN": 1690, "JAM": 1620,
    "NZL": 1600, "QAT": 1620, "HON": 1640,
}
DEFAULT_ELO = 1700.0
BASE_ELO    = 1500.0  # Startwert für historisches Warmup


# ── football-data.org ────────────────────────────────────────────────────────

FOOTBALL_API_KEY  = os.getenv("FOOTBALL_DATA_API_KEY", "")
FOOTBALL_API_BASE = "https://api.football-data.org/v4"
WC2026_COMP_CODE  = "WC"


def _api_headers() -> dict:
    return {"X-Auth-Token": FOOTBALL_API_KEY}


def _fetch_fdorg_matches(comp_code: str) -> tuple[list[dict], str]:
    """Alle Spiele eines Wettbewerbs von football-data.org abrufen."""
    url = f"{FOOTBALL_API_BASE}/competitions/{comp_code}/matches"
    try:
        with httpx.Client(timeout=10.0, follow_redirects=True) as client:
            r = client.get(url, headers=_api_headers())
        if r.status_code != 200:
            snippet = r.text[:120].replace("\n", " ") if r.text else ""
            return [], f"HTTP {r.status_code}" + (f" — {snippet}" if snippet else "")
        data = r.json()
        return data.get("matches") or [], ""
    except Exception as exc:
        return [], str(exc)


def _upsert_fdorg_team(db: Session, team_data: dict) -> Optional[models.WmtTeam]:
    """Team per football-data.org TLA anlegen oder aktualisieren."""
    tla = (team_data.get("tla") or "").strip().upper() or None
    if not tla:
        return None
    team = db.query(models.WmtTeam).filter_by(tla=tla).first()
    name = team_data.get("name") or "Unknown"
    short_name = team_data.get("shortName") or name
    api_id = team_data.get("id")
    if not team:
        team = models.WmtTeam(
            api_id=api_id,
            name=name,
            short_name=short_name,
            tla=tla,
            elo=INITIAL_ELO.get(tla, DEFAULT_ELO),
            matches_played=0,
        )
        db.add(team)
        db.flush()
    else:
        team.name = name
        if short_name:
            team.short_name = short_name
        if api_id:
            team.api_id = api_id
    return team


# ── openligadb ────────────────────────────────────────────────────────────────

OPENLIGADB_BASE = "https://api.openligadb.de"
WM2026_LEAGUE   = "wm2026"
WARMUP_LEAGUES: list[tuple[str, int]] = [
    ("wm2014", 2014),
    ("em2016", 2016),
    ("wm2018", 2018),
    ("em2021", 2021),   # EURO 2020 (gespielt 2021 wegen COVID)
    ("wm2022", 2022),
    ("em2024", 2024),
]


GERMAN_TO_TLA: dict[str, str] = {
    # WM 2026 + wichtige Nationen (deutsche Teambezeichnungen wie in openligadb)
    "Argentinien": "ARG", "Frankreich": "FRA", "Brasilien": "BRA",
    "England": "ENG", "Belgien": "BEL", "Portugal": "POR",
    "Spanien": "ESP", "Niederlande": "NED", "Deutschland": "GER",
    "Italien": "ITA", "Kroatien": "CRO", "Marokko": "MAR",
    "Uruguay": "URU", "Schweiz": "SUI", "Vereinigte Staaten": "USA",
    "USA": "USA", "Japan": "JPN", "Dänemark": "DEN",
    "Senegal": "SEN", "Kolumbien": "COL", "Mexiko": "MEX",
    "Österreich": "AUT", "Polen": "POL", "Ukraine": "UKR",
    "Südkorea": "KOR", "Korea, Republik": "KOR", "Serbien": "SRB",
    "Türkei": "TUR", "Ecuador": "ECU", "Kanada": "CAN",
    "Australien": "AUS", "Ghana": "GHA", "Kamerun": "CMR",
    "Saudi-Arabien": "SAU", "Ägypten": "EGY", "Iran": "IRN",
    "Tunesien": "TUN", "Elfenbeinküste": "CIV", "Côte d'Ivoire": "CIV",
    "Algerien": "ALG", "Rumänien": "ROU", "Ungarn": "HUN",
    "Tschechien": "CZE", "Tschechische Republik": "CZE",
    "Schottland": "SCO", "Wales": "WAL", "Nordirland": "NIR",
    "Venezuela": "VEN", "Paraguay": "PAR", "Nigeria": "NGA",
    "Costa Rica": "CRC", "Panama": "PAN", "Jamaika": "JAM",
    "Katar": "QAT", "Irak": "IRQ", "Jordanien": "JOR",
    "Usbekistan": "UZB", "Slowakei": "SVK", "Albanien": "ALB",
    "Griechenland": "GRE", "Honduras": "HON", "Neuseeland": "NZL",
    "Südafrika": "RSA",
    # Rest Europa
    "Russland": "RUS", "Schweden": "SWE", "Island": "ISL",
    "Irland": "IRL", "Republik Irland": "IRL",
    "Finnland": "FIN", "Norwegen": "NOR",
    "Nordmazedonien": "MKD", "Slowenien": "SVN",
    "Bosnien-Herzegowina": "BIH", "Bosnien und Herzegowina": "BIH",
    "Georgien": "GEO", "Kosovo": "XKX", "Armenien": "ARM",
    "Montenegro": "MNE", "Israel": "ISR", "Aserbaidschan": "AZE",
    "Weißrussland": "BLR", "Belarus": "BLR",
    "Estland": "EST", "Lettland": "LAT", "Litauen": "LTU",
    "Moldawien": "MDA", "Malta": "MLT", "Luxemburg": "LUX",
    "Andorra": "AND", "Färöer": "FRO", "Zypern": "CYP",
    "Gibraltar": "GIB", "Liechtenstein": "LIE", "San Marino": "SMR",
    "Bulgarien": "BUL",
    # Südamerika
    "Chile": "CHI", "Peru": "PER", "Bolivien": "BOL",
    # Afrika
    "DR Kongo": "COD", "Demokratische Republik Kongo": "COD",
    "Burkina Faso": "BFA", "Mali": "MLI", "Guinea": "GUI",
    "Sambia": "ZAM", "Kap Verde": "CPV", "Tansania": "TAN",
    "Äthiopien": "ETH", "Simbabwe": "ZIM", "Angola": "ANG",
    "Uganda": "UGA", "Kenia": "KEN", "Gabun": "GAB",
    "Äquatorialguinea": "EQG", "Gambia": "GAM", "Kongo": "CGO",
    "Guinea-Bissau": "GNB", "Benin": "BEN", "Komoren": "COM",
    "Mosambik": "MOZ", "Ruanda": "RWA", "Mauretanien": "MTN",
    "Namibia": "NAM", "Malawi": "MWI", "Sudan": "SDN",
    "Libyen": "LBA", "Togo": "TOG", "Niger": "NIG",
    "Liberia": "LBR", "Sierra Leone": "SLE",
    # Asien
    "China": "CHN", "China PR": "CHN",
    "Thailand": "THA", "Vietnam": "VIE", "Oman": "OMA",
    "Bahrain": "BHR", "Kuwait": "KUW", "Palästina": "PLE",
    "Syrien": "SYR", "Indien": "IND", "Indonesien": "IDN",
    "Vereinigte Arabische Emirate": "UAE", "Libanon": "LBN",
    "Kirgisistan": "KGZ", "Tadschikistan": "TJK",
    "Philippinen": "PHI", "Myanmar": "MYA", "Malaysia": "MAS",
    "Singapur": "SGP", "Pakistan": "PAK", "Nordkorea": "PRK",
    # CONCACAF
    "El Salvador": "SLV", "Guatemala": "GUA", "Kuba": "CUB",
    "Haiti": "HAI", "Trinidad und Tobago": "TRI",
    "Curaçao": "CUW", "Nicaragua": "NCA", "Belize": "BLZ",
    "Grenada": "GRN", "Guyana": "GUY", "Suriname": "SUR",
    "Dominikanische Republik": "DOM",
    # Ozeanien
    "Fidschi": "FIJ", "Papua-Neuguinea": "PNG",
    "Salomonen": "SOL", "Vanuatu": "VAN", "Tahiti": "TAH",
}


# ── prediction engine ────────────────────────────────────────────────────────

def elo_to_win_prob(home_elo: float, away_elo: float) -> tuple[float, float, float]:
    diff = home_elo - away_elo
    home_expected = 1.0 / (1.0 + 10.0 ** (-diff / 400.0))
    draw_prob = 0.28 * math.exp(-0.0015 * diff ** 2)
    draw_prob = max(0.05, min(0.38, draw_prob))
    home_win = home_expected * (1.0 - draw_prob)
    away_win = (1.0 - home_expected) * (1.0 - draw_prob)
    total = home_win + draw_prob + away_win
    return home_win / total, draw_prob / total, away_win / total


def elo_to_expected_goals(home_elo: float, away_elo: float) -> tuple[float, float]:
    diff = (home_elo - away_elo) / 400.0
    factor = 10.0 ** (diff * 0.5)
    home_xg = WC_AVG_GOALS * factor
    away_xg = WC_AVG_GOALS / factor
    return max(0.3, min(5.0, home_xg)), max(0.3, min(5.0, away_xg))


def update_elo_after_match(
    home_elo: float, away_elo: float, score_home: int, score_away: int,
    k_override: Optional[float] = None,
) -> tuple[float, float]:
    k = k_override if k_override is not None else ELO_K
    expected_home = 1.0 / (1.0 + 10.0 ** ((away_elo - home_elo) / 400.0))
    if score_home > score_away:
        actual_home = 1.0
    elif score_home < score_away:
        actual_home = 0.0
    else:
        actual_home = 0.5
    gd = abs(score_home - score_away)
    gd_mult = 1.0 if gd <= 1 else (1.5 if gd == 2 else (1.75 + (gd - 3) * 0.1))
    delta = k * gd_mult * (actual_home - expected_home)
    return home_elo + delta, away_elo - delta


def _form_decay_factor(years_ago: float) -> float:
    """ELO K-Faktor-Multiplikator: ältere Spiele zählen weniger."""
    if years_ago <= 2:  return 1.00
    if years_ago <= 3:  return 0.85
    if years_ago <= 4:  return 0.70
    return 0.55


def _stage_de(stage: str) -> str:
    mapping = {
        "GROUP_STAGE":    "Gruppenphase",
        "LAST_32":        "Rd. 32",
        "LAST_16":        "Achtelfinale",
        "ROUND_OF_16":    "Achtelfinale",
        "QUARTER_FINALS": "Viertelfinale",
        "SEMI_FINALS":    "Halbfinale",
        "THIRD_PLACE":    "Spiel um Platz 3",
        "FINAL":          "Finale",
    }
    return mapping.get(stage, stage.replace("_", " ").title())


def build_reasoning(
    home_name: str, away_name: str, home_tla: str, away_tla: str,
    home_elo: float, away_elo: float,
    home_win: float = 0.0, draw: float = 0.0, away_win: float = 0.0,
    home_xg: float = 0.0, away_xg: float = 0.0,
    trigger_note: Optional[str] = None,
) -> str:
    diff = home_elo - away_elo
    if abs(diff) < 30:
        strength = "Die Teams sind nahezu gleichwertig"
    elif diff > 0:
        label = "leichter" if diff < 100 else ("klarer" if diff < 200 else "deutlicher")
        strength = f"{home_name} ist {label} Favorit (+{diff:.0f} ELO)"
    else:
        label = "leichter" if abs(diff) < 100 else ("klarer" if abs(diff) < 200 else "deutlicher")
        strength = f"{away_name} ist {label} Favorit ({diff:.0f} ELO)"

    result = (
        f"{strength}.\n"
        f"ELO: {home_tla} {home_elo:.0f} vs. {away_tla} {away_elo:.0f}."
    )
    if trigger_note:
        result += f" {trigger_note}."
    return result


def _build_trigger_note(
    home_id: Optional[int],
    away_id: Optional[int],
    newly_finished: list,
    all_teams: dict,
) -> Optional[str]:
    """Build 'nach: ARG 2:1 FRA (MD1)' note for matches that shifted ELO."""
    relevant = []
    for m in newly_finished:
        if m.home_team_id in (home_id, away_id) or m.away_team_id in (home_id, away_id):
            h = all_teams.get(m.home_team_id) if m.home_team_id else None
            a = all_teams.get(m.away_team_id) if m.away_team_id else None
            h_tla = (h.tla or h.short_name or "?") if h else "?"
            a_tla = (a.tla or a.short_name or "?") if a else "?"
            stage_note = f"MD{m.matchday}" if m.stage == "GROUP_STAGE" else _stage_de(m.stage)
            relevant.append(f"{h_tla} {m.score_home}:{m.score_away} {a_tla} ({stage_note})")
    return ("nach: " + ", ".join(relevant)) if relevant else None


# ── openligadb helpers ────────────────────────────────────────────────────────

def _fetch_openligadb(league: str) -> tuple[list[dict], str]:
    """Alle Spiele einer openligadb-Liga abrufen."""
    url = f"{OPENLIGADB_BASE}/getmatchdata/{league}"
    try:
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            r = client.get(url, headers={"Accept": "application/json"})
        if r.status_code != 200:
            snippet = r.text[:120].replace("\n", " ") if r.text else ""
            return [], f"HTTP {r.status_code} — {snippet}" if snippet else f"HTTP {r.status_code}"
        data = r.json()
        if not isinstance(data, list):
            return [], f"Unerwartetes Format: {str(data)[:80]}"
        return data, ""
    except Exception as exc:
        return [], str(exc)


def _openligadb_final_score(match: dict) -> tuple[Optional[int], Optional[int]]:
    """Endergebnis (resultTypeID 2) aus matchResults extrahieren."""
    for res in (match.get("matchResults") or []):
        if res.get("resultTypeID") == 2:
            return res.get("pointsTeam1"), res.get("pointsTeam2")
    return None, None


def _openligadb_match_dt(match: dict) -> datetime:
    raw = match.get("matchDateTime", "")
    try:
        return datetime.fromisoformat(raw)
    except Exception:
        return datetime.min


def _openligadb_stage(group_name: str) -> str:
    """openligadb GroupName → internes Stage-Kürzel."""
    g = group_name.lower()
    if "spieltag" in g:                             return "GROUP_STAGE"
    if "letzten 32" in g or "rd. 32" in g:         return "LAST_32"
    if "achtelfinale" in g or "letzten 16" in g:   return "LAST_16"
    if "viertelfinale" in g:                        return "QUARTER_FINALS"
    if "halbfinale" in g:                           return "SEMI_FINALS"
    if "platz 3" in g:                              return "THIRD_PLACE"
    if "finale" in g:                               return "FINAL"
    return "GROUP_STAGE"


def _tla_from_openligadb_team(team: dict) -> Optional[str]:
    """TLA aus openligadb-Team-Objekt: zuerst GERMAN_TO_TLA, dann shortName."""
    name = team.get("teamName") or ""
    tla = GERMAN_TO_TLA.get(name)
    if tla:
        return tla
    short = (team.get("shortName") or "").strip().upper()
    if len(short) == 3 and short.isalpha():
        return short
    return None


def _upsert_openligadb_team(db: Session, team_data: dict) -> Optional[models.WmtTeam]:
    """Team per openligadb teamId anlegen oder aktualisieren."""
    t_id = team_data.get("teamId")
    if not t_id:
        return None
    name       = team_data.get("teamName") or "Unknown"
    short_name = team_data.get("shortName") or name
    tla        = _tla_from_openligadb_team(team_data)

    team = db.query(models.WmtTeam).filter_by(api_id=t_id).first()
    if not team:
        team = models.WmtTeam(
            api_id=t_id,
            name=name,
            short_name=short_name,
            tla=tla,
            elo=INITIAL_ELO.get(tla, DEFAULT_ELO) if tla else DEFAULT_ELO,
            matches_played=0,
        )
        db.add(team)
        db.flush()
    else:
        team.name = name
        if short_name:
            team.short_name = short_name
        if not team.tla and tla:
            team.tla = tla
    return team


# ── core business logic ───────────────────────────────────────────────────────

def _apply_elo_and_predictions(
    db: Session,
    newly_finished: list[models.WmtMatch],
    generate_predictions: bool = True,
) -> None:
    """ELO für neu abgeschlossene Spiele aktualisieren + Prognosen für ausstehende neu berechnen."""
    newly_finished.sort(key=lambda x: x.utc_date)
    for match in newly_finished:
        home = db.get(models.WmtTeam, match.home_team_id)
        away = db.get(models.WmtTeam, match.away_team_id)
        if home and away and match.score_home is not None and match.score_away is not None:
            new_h, new_a = update_elo_after_match(home.elo, away.elo, match.score_home, match.score_away)
            home.elo = new_h
            away.elo = new_a
            home.matches_played = (home.matches_played or 0) + 1
            away.matches_played = (away.matches_played or 0) + 1
    db.commit()

    if not generate_predictions:
        return

    # Auto-assign the next round's slots when a stage just completed
    _auto_assign_next_round(db)

    upcoming = (
        db.query(models.WmtMatch)
        .filter(models.WmtMatch.status.in_(["SCHEDULED", "TIMED"]))
        .all()
    )
    if not upcoming:
        return

    # Bulk-load teams and latest predictions to avoid N+1 (~80 queries → 2)
    all_teams = {t.id: t for t in db.query(models.WmtTeam).all()}
    latest_preds: dict[int, models.WmtPrediction] = {}
    upcoming_ids = [m.id for m in upcoming]
    for p in (
        db.query(models.WmtPrediction)
        .filter(models.WmtPrediction.match_id.in_(upcoming_ids))
        .order_by(models.WmtPrediction.created_at.desc())
        .all()
    ):
        if p.match_id not in latest_preds:
            latest_preds[p.match_id] = p

    for match in upcoming:
        home = all_teams.get(match.home_team_id) if match.home_team_id else None
        away = all_teams.get(match.away_team_id) if match.away_team_id else None
        if not home or not away:
            continue
        home_win, draw, away_win = elo_to_win_prob(home.elo, away.elo)
        home_xg, away_xg = elo_to_expected_goals(home.elo, away.elo)
        latest = latest_preds.get(match.id)
        if latest:
            if (abs((latest.home_elo or 0) - home.elo) < 5.0 and
                    abs((latest.away_elo or 0) - away.elo) < 5.0):
                continue
        home_tla = home.tla or home.short_name or home.name
        away_tla = away.tla or away.short_name or away.name
        trigger_note = _build_trigger_note(
            match.home_team_id, match.away_team_id, newly_finished, all_teams
        )
        reasoning = build_reasoning(
            home.name, away.name, home_tla, away_tla,
            home.elo, away.elo, home_win, draw, away_win, home_xg, away_xg,
            trigger_note=trigger_note,
        )
        db.add(models.WmtPrediction(
            match_id=match.id,
            home_win_prob=home_win,
            draw_prob=draw,
            away_win_prob=away_win,
            pred_home_goals=home_xg,
            pred_away_goals=away_xg,
            home_elo=home.elo,
            away_elo=away.elo,
            reasoning=reasoning,
        ))
    db.commit()


def _do_refresh_fdorg(db: Session) -> tuple[int, str]:
    """WM 2026-Spielplan von football-data.org laden (alle 104 Spiele)."""
    matches_data, err = _fetch_fdorg_matches(WC2026_COMP_CODE)
    if err:
        logger.warning("WMT football-data.org %s: %s", WC2026_COMP_CODE, err)
        return 0, f"football-data.org: {err}"
    if not matches_data:
        return 0, "football-data.org: Keine Spiele zurückgegeben"

    updated = 0
    newly_finished: list[models.WmtMatch] = []

    for m in matches_data:
        match_id = m.get("id")
        if not match_id:
            continue

        home_data = m.get("homeTeam") or {}
        away_data = m.get("awayTeam") or {}
        home_team = _upsert_fdorg_team(db, home_data)
        away_team = _upsert_fdorg_team(db, away_data)

        status_raw = m.get("status", "SCHEDULED")
        is_finished = status_raw == "FINISHED"
        score = m.get("score") or {}
        full_time = score.get("fullTime") or {}
        score_home = full_time.get("home")
        score_away = full_time.get("away")
        status = "FINISHED" if is_finished and score_home is not None else (
            "LIVE" if status_raw in ("IN_PLAY", "PAUSED") else "SCHEDULED"
        )

        stage = m.get("stage", "GROUP_STAGE")
        group_raw = m.get("group") or ""
        group_name = group_raw.replace("GROUP_", "") if group_raw.startswith("GROUP_") else None
        matchday = m.get("matchday") or 0

        utc_date_str = m.get("utcDate", "")
        try:
            utc_date = datetime.fromisoformat(utc_date_str.replace("Z", "+00:00"))
        except Exception:
            utc_date = datetime.min

        match = db.query(models.WmtMatch).filter_by(api_id=match_id).first()
        if not match:
            match = models.WmtMatch(
                api_id=match_id,
                matchday=matchday,
                stage=stage,
                group_name=group_name,
                utc_date=utc_date,
                home_team_id=home_team.id if home_team else None,
                away_team_id=away_team.id if away_team else None,
                status=status,
                last_fetched=datetime.utcnow(),
            )
            db.add(match)
            db.flush()
            updated += 1
        else:
            was_finished = match.status == "FINISHED"
            match.status = status
            match.last_fetched = datetime.utcnow()
            if home_team:
                match.home_team_id = home_team.id
            if away_team:
                match.away_team_id = away_team.id
            if status == "FINISHED" and score_home is not None and score_away is not None:
                if not was_finished:
                    match.score_home = score_home
                    match.score_away = score_away
                    newly_finished.append(match)
                    updated += 1
                else:
                    match.score_home = score_home
                    match.score_away = score_away

    db.commit()
    _apply_elo_and_predictions(db, newly_finished)
    return updated, ""


def _do_refresh_openligadb(db: Session) -> tuple[int, str]:
    """WM 2026-Spielplan von openligadb laden (Fallback, nur 1. Spieltag)."""
    matches_data, err = _fetch_openligadb(WM2026_LEAGUE)
    if err:
        logger.warning("WMT openligadb %s: %s", WM2026_LEAGUE, err)
        return 0, f"openligadb '{WM2026_LEAGUE}': {err}"
    if not matches_data:
        return 0, f"openligadb: Keine Spiele in Liga '{WM2026_LEAGUE}' — Liga möglicherweise noch nicht angelegt"

    total_received = len(matches_data)
    updated = 0
    skipped_no_id = 0
    newly_finished: list[models.WmtMatch] = []

    for m in matches_data:
        openligadb_id = m.get("matchID")
        if not openligadb_id:
            skipped_no_id += 1
            continue

        t1 = m.get("team1") or {}
        t2 = m.get("team2") or {}
        home_team = _upsert_openligadb_team(db, t1)
        away_team = _upsert_openligadb_team(db, t2)

        is_finished  = bool(m.get("matchIsFinished"))
        score_home, score_away = _openligadb_final_score(m)
        status = "FINISHED" if is_finished and score_home is not None else "SCHEDULED"

        group     = m.get("group") or {}
        group_raw = group.get("groupName", "")
        stage     = _openligadb_stage(group_raw)
        raw_grp   = (t1.get("teamGroupName") or "").replace("Gruppe ", "").strip()
        group_name = raw_grp if len(raw_grp) == 1 else None

        match = db.query(models.WmtMatch).filter_by(api_id=openligadb_id).first()
        if not match:
            match = models.WmtMatch(
                api_id=openligadb_id,
                matchday=group.get("groupOrderID") or 0,
                stage=stage,
                group_name=group_name,
                utc_date=_openligadb_match_dt(m),
                home_team_id=home_team.id if home_team else None,
                away_team_id=away_team.id if away_team else None,
                status=status,
                last_fetched=datetime.utcnow(),
            )
            db.add(match)
            db.flush()
            updated += 1
        else:
            was_finished = match.status == "FINISHED"
            match.status = status
            match.last_fetched = datetime.utcnow()
            if home_team:
                match.home_team_id = home_team.id
            if away_team:
                match.away_team_id = away_team.id
            if status == "FINISHED" and score_home is not None and score_away is not None:
                if not was_finished:
                    match.score_home = score_home
                    match.score_away = score_away
                    newly_finished.append(match)
                    updated += 1
                else:
                    match.score_home = score_home
                    match.score_away = score_away

    db.commit()
    _apply_elo_and_predictions(db, newly_finished)

    if updated == 0 and total_received > 0 and skipped_no_id == total_received:
        first_keys = list(matches_data[0].keys())[:6]
        return 0, (
            f"openligadb: {total_received} Objekte empfangen, 0 eingefügt "
            f"(alle matchIDs fehlend — Felder: {first_keys})"
        )
    return updated, ""


def do_refresh(db: Session) -> tuple[int, str]:
    """
    WM 2026-Spielplan laden: football-data.org (alle 104 Spiele) wenn API-Key gesetzt,
    sonst openligadb (Fallback, nur erster Spieltag).
    Returns (updated_count, error_message).
    """
    if FOOTBALL_API_KEY:
        return _do_refresh_fdorg(db)
    return _do_refresh_openligadb(db)


def do_generate_summary(db: Session, for_date: Optional[date] = None) -> str:
    """Tagesrückblick für die Spiele des Vortags generieren und speichern."""
    target  = for_date or (date.today() - timedelta(days=1))
    day_start = datetime(target.year, target.month, target.day)
    day_end   = day_start + timedelta(days=1)

    finished = (
        db.query(models.WmtMatch)
        .filter(
            models.WmtMatch.status == "FINISHED",
            models.WmtMatch.utc_date >= day_start,
            models.WmtMatch.utc_date < day_end,
        )
        .order_by(models.WmtMatch.utc_date)
        .all()
    )
    if not finished:
        return ""

    lines = [f"## Spieltag-Zusammenfassung — {target.strftime('%d.%m.%Y')}"]
    lines.append(f"\n{len(finished)} Spiel{'e' if len(finished) != 1 else ''} gestern:\n")

    upsets: list[str] = []
    correct = 0

    for m in finished:
        home = db.get(models.WmtTeam, m.home_team_id)
        away = db.get(models.WmtTeam, m.away_team_id)
        home_name = (home.short_name if home else None) or "?"
        away_name = (away.short_name if away else None) or "?"
        score = f"{m.score_home}:{m.score_away}"
        group_info = f"Gr. {m.group_name}" if m.group_name else _stage_de(m.stage)
        line = f"**{home_name} {score} {away_name}** ({group_info})"

        pred = (
            db.query(models.WmtPrediction)
            .filter_by(match_id=m.id)
            .order_by(models.WmtPrediction.created_at.desc())
            .first()
        )
        if pred and m.score_home is not None and m.score_away is not None:
            ph = round(pred.pred_home_goals)
            pa = round(pred.pred_away_goals)
            pred_correct = (
                (m.score_home > m.score_away  and pred.pred_home_goals > pred.pred_away_goals) or
                (m.score_home < m.score_away  and pred.pred_home_goals < pred.pred_away_goals) or
                (m.score_home == m.score_away and abs(pred.pred_home_goals - pred.pred_away_goals) < 0.5)
            )
            marker = "✓" if pred_correct else "✗"
            if pred_correct:
                correct += 1
            line += f" — Prognose {ph}:{pa} {marker}"

            if m.score_home < m.score_away and pred.home_win_prob > 0.55 and away:
                upsets.append(f"{away.short_name} schlug {home.short_name}")
            elif m.score_home > m.score_away and pred.away_win_prob > 0.55 and home:
                upsets.append(f"{home.short_name} schlug {away.short_name}")

        lines.append(f"- {line}")

    total = len(finished)
    lines.append(f"\nTreffgenauigkeit (Tendenz): **{correct}/{total}** Spiele richtig vorhergesagt.")
    if upsets:
        lines.append(f"\n**Überraschungen:** {', '.join(upsets)}.")

    content = "\n".join(lines)
    existing = db.query(models.WmtSummary).filter_by(date=target).first()
    if existing:
        existing.content = content
        existing.matches_count = total
    else:
        db.add(models.WmtSummary(date=target, content=content, matches_count=total))
    db.commit()
    return content


# ── Bonus-Prognose: Monte-Carlo-Turniersimulation ─────────────────────────────

TOP_PLAYERS: dict[str, tuple[str, float]] = {
    "ARG": ("Lautaro Martínez",  0.52),
    "FRA": ("Kylian Mbappé",     0.58),
    "BRA": ("Vinicius Jr.",      0.42),
    "ENG": ("Harry Kane",        0.50),
    "POR": ("Cristiano Ronaldo", 0.46),
    "GER": ("Kai Havertz",       0.38),
    "ESP": ("Álvaro Morata",     0.34),
    "NED": ("Donyell Malen",     0.35),
    "BEL": ("Romelu Lukaku",     0.40),
    "URU": ("Darwin Núñez",      0.42),
    "COL": ("Luis Díaz",         0.35),
    "USA": ("Christian Pulisic", 0.32),
    "MAR": ("Youssef En-Nesyri", 0.36),
    "CRO": ("Andrej Kramarić",   0.35),
    "JPN": ("Ayase Ueda",        0.38),
    "SEN": ("Sadio Mané",        0.30),
    "ITA": ("Gianluca Scamacca", 0.30),
    "MEX": ("Hirving Lozano",    0.30),
    "CAN": ("Alphonso Davies",   0.28),
    "TUR": ("Arda Güler",        0.32),
}


def _sample_goals_poisson(lam: float) -> int:
    L = math.exp(-max(0.01, min(15.0, lam)))
    k, p = 0, 1.0
    while p > L:
        k += 1
        p *= random.random()
    return k - 1


def _compute_top_scorer(db: Session) -> dict:
    """Torjäger-Prognose auf Basis von ELO-Stärke + historischer Torquote."""
    all_teams   = {t.id: t for t in db.query(models.WmtTeam).all()}
    tla_to_team = {t.tla: t for t in all_teams.values() if t.tla}

    candidates: list[dict] = []
    for tla, (player, rate) in TOP_PLAYERS.items():
        wc_team = tla_to_team.get(tla)
        if not wc_team:
            continue
        exp_m = 3.0 + 3.5 * min(1.0, max(0.0, (wc_team.elo - 1600) / 400))
        candidates.append({
            "player": player,
            "team":   wc_team.short_name or wc_team.name,
            "tla":    tla,
            "goals":  round(rate * exp_m, 1),
            "source": "ELO-Schätzung",
            "_score": rate * exp_m,
        })

    if not candidates:
        return {"player": "unbekannt", "team": "?", "tla": "?", "goals": 0.0, "source": "keine Daten"}

    best = max(candidates, key=lambda x: x["_score"])
    return {k: v for k, v in best.items() if k != "_score"}


def do_generate_bonus(db: Session, n_sims: int = 10000) -> Optional[models.WmtBonusPrediction]:
    """Monte-Carlo-Simulation WM 2026: Gruppenphase + K.o.-Runde."""
    all_teams = {t.id: t for t in db.query(models.WmtTeam).all()}
    if not all_teams:
        return None

    group_matches_q = (
        db.query(models.WmtMatch)
        .filter(models.WmtMatch.stage == "GROUP_STAGE")
        .all()
    )
    group_to_matches: dict[str, list] = defaultdict(list)
    for m in group_matches_q:
        if m.group_name:
            group_to_matches[m.group_name].append(m)

    if not group_to_matches:
        return None

    group_to_teams: dict[str, set] = defaultdict(set)
    for group, matches in group_to_matches.items():
        for m in matches:
            if m.home_team_id: group_to_teams[group].add(m.home_team_id)
            if m.away_team_id: group_to_teams[group].add(m.away_team_id)

    group_win_count: dict[int, int] = defaultdict(int)
    top2_count:      dict[int, int] = defaultdict(int)
    top3_count:      dict[int, int] = defaultdict(int)
    semi_count:      dict[int, int] = defaultdict(int)
    final_count:     dict[int, int] = defaultdict(int)
    win_count:       dict[int, int] = defaultdict(int)

    for _ in range(n_sims):
        third_pool: list[tuple] = []
        qualifiers: list[tuple] = []

        for group_name in sorted(group_to_matches.keys()):
            team_ids = list(group_to_teams[group_name])
            matches  = group_to_matches[group_name]

            pts: dict[int, int] = defaultdict(int)
            gd:  dict[int, int] = defaultdict(int)
            gf:  dict[int, int] = defaultdict(int)

            for m in matches:
                if not m.home_team_id or not m.away_team_id:
                    continue
                ht = all_teams.get(m.home_team_id)
                at = all_teams.get(m.away_team_id)
                if not ht or not at:
                    continue

                if m.status == "FINISHED" and m.score_home is not None:
                    h, a = m.score_home, m.score_away
                else:
                    h_xg, a_xg = elo_to_expected_goals(ht.elo, at.elo)
                    h = _sample_goals_poisson(h_xg)
                    a = _sample_goals_poisson(a_xg)

                if h > a:   pts[m.home_team_id] += 3
                elif h < a: pts[m.away_team_id] += 3
                else:
                    pts[m.home_team_id] += 1
                    pts[m.away_team_id] += 1
                gd[m.home_team_id] += h - a
                gd[m.away_team_id] += a - h
                gf[m.home_team_id] += h
                gf[m.away_team_id] += a

            sorted_ids = sorted(
                team_ids,
                key=lambda t: (
                    pts[t], gd[t], gf[t],
                    all_teams[t].elo if t in all_teams else DEFAULT_ELO,
                    random.random(),
                ),
                reverse=True,
            )
            for rank, tid in enumerate(sorted_ids):
                elo = all_teams[tid].elo if tid in all_teams else DEFAULT_ELO
                if rank == 0:
                    group_win_count[tid] += 1
                    top2_count[tid] += 1
                    top3_count[tid] += 1
                    qualifiers.append((tid, elo))
                elif rank == 1:
                    top2_count[tid] += 1
                    top3_count[tid] += 1
                    qualifiers.append((tid, elo))
                elif rank == 2:
                    top3_count[tid] += 1
                    third_pool.append((pts[tid], gd[tid], gf[tid], tid, elo))

        third_pool.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
        for _, _, _, tid, elo in third_pool[:8]:
            qualifiers.append((tid, elo))

        if len(qualifiers) < 4:
            continue

        bracket = qualifiers[:]
        random.shuffle(bracket)
        current = bracket
        while len(current) > 1:
            if len(current) == 4:
                for tid, _ in current:
                    semi_count[tid] += 1
            elif len(current) == 2:
                for tid, _ in current:
                    final_count[tid] += 1

            next_round: list[tuple] = []
            for i in range(0, len(current) - 1, 2):
                t1, e1 = current[i]
                t2, e2 = current[i + 1]
                h_xg, a_xg = elo_to_expected_goals(e1, e2)
                h = _sample_goals_poisson(h_xg)
                a = _sample_goals_poisson(a_xg)
                if h > a:
                    winner = (t1, e1)
                elif a > h:
                    winner = (t2, e2)
                else:
                    hw, _, aw = elo_to_win_prob(e1, e2)
                    winner = (t1, e1) if random.random() < hw / (hw + aw) else (t2, e2)
                next_round.append(winner)
            if len(current) % 2 == 1:
                next_round.append(current[-1])
            current = next_round

        if current:
            win_count[current[0][0]] += 1

    all_ids = list(all_teams.keys())

    group_winners: dict[str, list] = {}
    for group_name in sorted(group_to_teams.keys()):
        tids = list(group_to_teams[group_name])
        if not tids:
            continue
        ranked = sorted(tids, key=lambda t: group_win_count.get(t, 0), reverse=True)
        group_winners[group_name] = [
            {
                "team":      all_teams[tid].short_name or all_teams[tid].name,
                "tla":       all_teams[tid].tla or "?",
                "prob_1st":  round(group_win_count.get(tid, 0) / n_sims, 3),
                "prob_top2": round(top2_count.get(tid, 0) / n_sims, 3),
                "prob_top3": round(top3_count.get(tid, 0) / n_sims, 3),
            }
            for tid in ranked if all_teams.get(tid)
        ]

    semifinalists = sorted(
        [{"team": all_teams[t].short_name or all_teams[t].name,
          "tla":  all_teams[t].tla or "?",
          "prob": round(semi_count[t] / n_sims, 3)}
         for t in all_ids if semi_count.get(t, 0) > 0],
        key=lambda x: -x["prob"],
    )[:4]

    finalists = sorted(
        [{"team": all_teams[t].short_name or all_teams[t].name,
          "tla":  all_teams[t].tla or "?",
          "prob": round(final_count[t] / n_sims, 3)}
         for t in all_ids if final_count.get(t, 0) > 0],
        key=lambda x: -x["prob"],
    )[:2]

    if win_count:
        winner_id = max(all_ids, key=lambda t: win_count.get(t, 0))
        w = all_teams[winner_id]
        winner = {
            "team": w.short_name or w.name,
            "tla":  w.tla or "?",
            "prob": round(win_count.get(winner_id, 0) / n_sims, 3),
        }
    else:
        winner = {"team": "?", "tla": "?", "prob": 0.0}

    top_scorer = _compute_top_scorer(db)

    record = models.WmtBonusPrediction(
        group_winners=group_winners,
        semifinalists=semifinalists,
        finalists=finalists,
        winner=winner,
        top_scorer=top_scorer,
        n_simulations=n_sims,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def do_historical_warmup(db: Session) -> dict:
    """
    Historische ELO-Kalibrierung via openligadb:
    1. DB-Teams auf INITIAL_ELO-Startwerte zurücksetzen
    2. WM2014 → EM2024 Spiele chronologisch mit Form-Decay-K-Faktor verarbeiten
    3. WM-2026-Ergebnisse aus DB einrechnen
    4. Ergebnisse zurückschreiben
    """
    wall_start = time.time()
    logs: list[dict] = []
    now_dt = datetime.utcnow()

    def log(text: str, level: str = "info") -> None:
        logs.append({"ts": datetime.utcnow().isoformat() + "Z", "text": text, "level": level})
        logger.info("WMT warmup: %s", text)

    # ── Step 1: DB-Teams zurücksetzen ─────────────────────────────────────
    all_db_teams = db.query(models.WmtTeam).all()
    for t in all_db_teams:
        t.elo = INITIAL_ELO.get(t.tla, BASE_ELO) if t.tla else BASE_ELO
        t.matches_played = 0
    db.commit()
    log(f"Zurückgesetzt: {len(all_db_teams)} Teams mit INITIAL_ELO-Startwerten")

    # ── Step 2: TLA-keyed in-memory ELO ───────────────────────────────────
    elo_tla: dict[str, float] = {}
    for t in all_db_teams:
        if t.tla:
            elo_tla[t.tla] = t.elo

    # ── Step 3: openligadb historische Wettbewerbe ────────────────────────
    total_hist_matches = 0
    competitions_processed = 0

    for league, year in WARMUP_LEAGUES:
        log(f"─── {league} — Anfrage läuft…")
        t_req = time.time()
        matches, err = _fetch_openligadb(f"{league}/{year}")
        req_time = time.time() - t_req

        if err or not matches:
            log(f"  {err or 'Keine Daten'} ({req_time:.2f}s) — überspringe {league}", "error")
            continue

        finished = [m for m in matches if m.get("matchIsFinished")]
        if not finished:
            log(f"  Antwort {req_time:.2f}s — Keine abgeschlossenen Spiele")
            continue

        finished.sort(key=_openligadb_match_dt)
        first_dt = _openligadb_match_dt(finished[0])
        last_dt  = _openligadb_match_dt(finished[-1])

        total_goals = 0
        k_sum = 0.0
        elo_before = dict(elo_tla)
        highlight: Optional[str] = None
        highlight_margin = 0
        teams_seen: set = set()
        processed = 0

        no_tla_teams: set[str] = set()
        no_score_count = 0

        for m in finished:
            t1 = m.get("team1") or {}
            t2 = m.get("team2") or {}
            h_tla = _tla_from_openligadb_team(t1)
            a_tla = _tla_from_openligadb_team(t2)
            if not h_tla:
                no_tla_teams.add(t1.get("teamName") or t1.get("shortName") or "?")
            if not a_tla:
                no_tla_teams.add(t2.get("teamName") or t2.get("shortName") or "?")
            if not h_tla or not a_tla:
                continue
            h_g, a_g = _openligadb_final_score(m)
            if h_g is None or a_g is None:
                no_score_count += 1
                continue

            if h_tla not in elo_tla: elo_tla[h_tla] = BASE_ELO
            if a_tla not in elo_tla: elo_tla[a_tla] = BASE_ELO
            teams_seen.update([h_tla, a_tla])

            years_ago = (now_dt - _openligadb_match_dt(m)).days / 365.25
            k_mult    = _form_decay_factor(years_ago)
            k_eff     = ELO_K * k_mult
            k_sum    += k_mult

            new_h, new_a = update_elo_after_match(
                elo_tla[h_tla], elo_tla[a_tla], h_g, a_g, k_override=k_eff
            )
            elo_tla[h_tla] = new_h
            elo_tla[a_tla] = new_a
            total_goals += h_g + a_g
            processed += 1
            margin = abs(h_g - a_g)
            if margin > highlight_margin:
                highlight_margin = margin
                highlight = f"{h_tla} {h_g}:{a_g} {a_tla}"

        if not processed:
            parts = [f"Antwort {req_time:.2f}s — Keine verwertbaren Spiele ({len(finished)} abgeschlossen)"]
            if no_tla_teams:
                sample = sorted(no_tla_teams)[:5]
                parts.append(f"Kein TLA für: {', '.join(sample)}")
            if no_score_count:
                parts.append(f"{no_score_count} Spiele ohne Ergebnis")
            log("  " + " | ".join(parts), "error")
            continue

        avg_goals = total_goals / processed
        avg_k     = k_sum / processed
        date_range = f"{first_dt.strftime('%d.%m.%Y')} – {last_dt.strftime('%d.%m.%Y')}"
        hl_str = f" | Highlight: {highlight}" if highlight else ""
        log(
            f"  Antwort {req_time:.2f}s | {len(teams_seen)} Teams | {processed} Spiele "
            f"({date_range}) | {total_goals} Tore (Ø {avg_goals:.2f}/Spiel) | "
            f"K-Faktor Ø {avg_k:.2f}x{hl_str}",
            "done",
        )

        deltas  = {tla: elo_tla[tla] - elo_before.get(tla, BASE_ELO) for tla in elo_tla}
        gainers = sorted([(t, d) for t, d in deltas.items() if d > 0.5], key=lambda x: -x[1])[:3]
        losers  = sorted([(t, d) for t, d in deltas.items() if d < -0.5], key=lambda x: x[1])[:3]
        if gainers:
            log("  ▲ ELO-Gewinner: " + " | ".join(f"{t} +{d:.0f}" for t, d in gainers), "done")
        if losers:
            log("  ▼ ELO-Verlierer: " + " | ".join(f"{t} {d:.0f}" for t, d in losers))

        total_hist_matches += processed
        competitions_processed += 1

    # ── Step 4: WM 2026 gespielte Spiele einrechnen ───────────────────────
    played_count: dict[int, int] = defaultdict(int)
    wc26_finished = (
        db.query(models.WmtMatch)
        .filter(models.WmtMatch.status == "FINISHED")
        .order_by(models.WmtMatch.utc_date)
        .all()
    )
    if wc26_finished:
        log(f"WM 2026: {len(wc26_finished)} gespielte Spiele werden eingerechnet…")
        for m in wc26_finished:
            home = db.get(models.WmtTeam, m.home_team_id)
            away = db.get(models.WmtTeam, m.away_team_id)
            if not home or not away:
                continue
            h_tla = home.tla
            a_tla = away.tla
            if not h_tla or not a_tla or m.score_home is None or m.score_away is None:
                continue
            if h_tla not in elo_tla: elo_tla[h_tla] = BASE_ELO
            if a_tla not in elo_tla: elo_tla[a_tla] = BASE_ELO
            new_h, new_a = update_elo_after_match(
                elo_tla[h_tla], elo_tla[a_tla], m.score_home, m.score_away
            )
            elo_tla[h_tla] = new_h
            elo_tla[a_tla] = new_a
            played_count[m.home_team_id] += 1
            played_count[m.away_team_id] += 1
        log(f"  {len(wc26_finished)} WM-2026-Spiele eingerechnet", "done")

    # ── Step 5: In DB zurückschreiben ─────────────────────────────────────
    teams_updated = 0
    db.expire_all()
    for t in db.query(models.WmtTeam).all():
        if t.tla and t.tla in elo_tla:
            t.elo = round(elo_tla[t.tla], 1)
            t.matches_played = played_count.get(t.id, 0)
            teams_updated += 1
    db.commit()

    db.query(models.WmtPrediction).delete()
    db.commit()
    log("Alte Prognosen gelöscht — bitte Spielplan aktualisieren (☰) für neue Prognosen")

    top_teams = sorted(
        db.query(models.WmtTeam).all(),
        key=lambda t: t.elo, reverse=True,
    )[:5]
    top_str = " | ".join(f"{t.tla} {t.elo:.0f}" for t in top_teams if t.tla)

    elapsed = time.time() - wall_start
    log("━━━ Kalibrierung abgeschlossen ━━━", "done")
    log(
        f"Laufzeit: {elapsed:.1f}s | Wettbewerbe: {competitions_processed} | "
        f"Spiele: {total_hist_matches} | Teams aktualisiert: {teams_updated}",
        "done",
    )
    if top_str:
        log(f"Stärkste Teams: {top_str}", "done")

    return {
        "message": (
            f"Kalibrierung abgeschlossen ({total_hist_matches} Spiele aus "
            f"{competitions_processed} Wettbewerben)."
        ),
        "logs": logs,
        "competitions_processed": competitions_processed,
        "matches_processed": total_hist_matches,
        "teams_updated": teams_updated,
        "elapsed_seconds": round(elapsed, 1),
    }


# ── fake results (dev/test) ───────────────────────────────────────────────────

def do_fake_group_md(
    db: Session, matchday: int, n_upsets: int, generate_predictions: bool = True,
) -> tuple[int, str]:
    """Fake-Ergebnisse für alle ausstehenden Gruppenphase-Spiele eines Spieltags setzen."""
    md_matches = (
        db.query(models.WmtMatch)
        .filter(
            models.WmtMatch.stage == "GROUP_STAGE",
            models.WmtMatch.matchday == matchday,
            models.WmtMatch.status != "FINISHED",
            models.WmtMatch.home_team_id.isnot(None),
            models.WmtMatch.away_team_id.isnot(None),
        )
        .order_by(models.WmtMatch.utc_date)
        .all()
    )
    if not md_matches:
        return 0, f"Keine ausstehenden MD{matchday}-Spiele mit Teambesetzung gefunden."

    all_teams = {t.id: t for t in db.query(models.WmtTeam).all()}

    def elo_gap(m: models.WmtMatch) -> float:
        h = all_teams.get(m.home_team_id)
        a = all_teams.get(m.away_team_id)
        return abs(h.elo - a.elo) if h and a else 0.0

    n = min(n_upsets, len(md_matches))
    upset_ids = {m.id for m in sorted(md_matches, key=elo_gap, reverse=True)[:n]}

    newly_finished: list[models.WmtMatch] = []
    for m in md_matches:
        home = all_teams.get(m.home_team_id)
        away = all_teams.get(m.away_team_id)
        if not home or not away:
            continue

        home_win, _, away_win = elo_to_win_prob(home.elo, away.elo)
        home_xg, away_xg = elo_to_expected_goals(home.elo, away.elo)
        tip_h = max(0, round(home_xg))
        tip_a = max(0, round(away_xg))
        if tip_h == tip_a:
            if home_win > away_win + 0.1:
                tip_h += 1
            elif away_win > home_win + 0.1:
                tip_a += 1

        if m.id in upset_ids:
            if tip_h != tip_a:
                score_h, score_a = tip_a, tip_h
            else:
                if home.elo <= away.elo:
                    score_h, score_a = 1, 0
                else:
                    score_h, score_a = 0, 1
        else:
            score_h, score_a = tip_h, tip_a

        m.score_home = score_h
        m.score_away = score_a
        m.status = "FINISHED"
        newly_finished.append(m)

    db.commit()
    _apply_elo_and_predictions(db, newly_finished, generate_predictions)
    return len(newly_finished), ""


def do_fake_md1(db: Session) -> tuple[int, str]:
    return do_fake_group_md(db, 1, 3)


def _compute_group_standings(db: Session) -> dict[str, list[dict]]:
    """Gruppenplatzierungen aus abgeschlossenen Spielen berechnen."""
    group_matches = (
        db.query(models.WmtMatch)
        .filter(
            models.WmtMatch.stage == "GROUP_STAGE",
            models.WmtMatch.status == "FINISHED",
            models.WmtMatch.group_name.isnot(None),
        )
        .all()
    )

    pts: dict[str, dict] = defaultdict(lambda: defaultdict(int))
    gd:  dict[str, dict] = defaultdict(lambda: defaultdict(int))
    gf:  dict[str, dict] = defaultdict(lambda: defaultdict(int))
    team_ids_by_group: dict[str, set] = defaultdict(set)

    for m in group_matches:
        g = m.group_name
        if not m.home_team_id or not m.away_team_id or m.score_home is None:
            continue
        team_ids_by_group[g].add(m.home_team_id)
        team_ids_by_group[g].add(m.away_team_id)
        if m.score_home > m.score_away:
            pts[g][m.home_team_id] += 3
        elif m.score_home < m.score_away:
            pts[g][m.away_team_id] += 3
        else:
            pts[g][m.home_team_id] += 1
            pts[g][m.away_team_id] += 1
        gd[g][m.home_team_id] += m.score_home - m.score_away
        gd[g][m.away_team_id] += m.score_away - m.score_home
        gf[g][m.home_team_id] += m.score_home
        gf[g][m.away_team_id] += m.score_away

    all_teams = {t.id: t for t in db.query(models.WmtTeam).all()}

    standings: dict[str, list[dict]] = {}
    for group in sorted(team_ids_by_group.keys()):
        team_ids = list(team_ids_by_group[group])
        sorted_ids = sorted(
            team_ids,
            key=lambda t: (
                pts[group][t], gd[group][t], gf[group][t],
                all_teams[t].elo if t in all_teams else DEFAULT_ELO,
            ),
            reverse=True,
        )
        standings[group] = [
            {
                "team_id": t,
                "pts":   pts[group][t],
                "gd":    gd[group][t],
                "gf":    gf[group][t],
                "elo":   all_teams[t].elo if t in all_teams else DEFAULT_ELO,
                "group": group,
            }
            for t in sorted_ids
        ]
    return standings


def do_fake_rd32(db: Session, generate_predictions: bool = True) -> tuple[int, str]:
    """Fake-Ergebnisse für Rd.32 setzen (benötigt abgeschlossene Gruppenphase)."""
    standings = _compute_group_standings(db)
    if not standings:
        return 0, "Keine abgeschlossenen Gruppenspiele gefunden."
    if len(standings) < 12:
        return 0, f"Nur {len(standings)} von 12 Gruppen haben Ergebnisse."

    qualifiers: list[dict] = []
    third_pool: list[dict] = []
    for group in sorted(standings.keys()):
        table = standings[group]
        if len(table) >= 1:
            qualifiers.append(table[0])
        if len(table) >= 2:
            qualifiers.append(table[1])
        if len(table) >= 3:
            third_pool.append(table[2])

    third_pool.sort(key=lambda x: (x["pts"], x["gd"], x["gf"]), reverse=True)
    qualifiers.extend(third_pool[:8])

    if len(qualifiers) < 32:
        return 0, f"Nur {len(qualifiers)} Qualifikanten gefunden (erwartet: 32)."
    qualifiers = qualifiers[:32]

    rd32_matches = (
        db.query(models.WmtMatch)
        .filter(
            models.WmtMatch.stage == "LAST_32",
            models.WmtMatch.status != "FINISHED",
        )
        .order_by(models.WmtMatch.utc_date)
        .all()
    )
    if not rd32_matches:
        return 0, "Keine ausstehenden LAST_32-Spiele gefunden."
    if len(rd32_matches) != 16:
        return 0, f"{len(rd32_matches)} LAST_32-Spiele gefunden (erwartet: 16)."

    # Pair strongest vs weakest (rank-1 vs rank-32, rank-2 vs rank-31, …)
    qualifiers.sort(key=lambda x: x["elo"], reverse=True)
    pairs = [(qualifiers[i]["team_id"], qualifiers[31 - i]["team_id"]) for i in range(16)]

    # Largest ELO-gap pairs become upsets
    pairs_with_gap = sorted(
        range(16),
        key=lambda i: abs(
            (qualifiers[i]["elo"] if i < len(qualifiers) else DEFAULT_ELO) -
            (qualifiers[31 - i]["elo"] if (31 - i) < len(qualifiers) else DEFAULT_ELO)
        ),
        reverse=True,
    )
    upset_indices = set(pairs_with_gap[:5])

    all_teams = {t.id: t for t in db.query(models.WmtTeam).all()}
    newly_finished: list[models.WmtMatch] = []

    for slot, (m, (h_id, a_id)) in enumerate(zip(rd32_matches, pairs)):
        home_team = all_teams.get(h_id)
        away_team = all_teams.get(a_id)
        if not home_team or not away_team:
            continue

        m.home_team_id = h_id
        m.away_team_id = a_id

        home_win, _, away_win = elo_to_win_prob(home_team.elo, away_team.elo)
        home_xg, away_xg = elo_to_expected_goals(home_team.elo, away_team.elo)
        tip_h = max(0, round(home_xg))
        tip_a = max(0, round(away_xg))
        if tip_h == tip_a:
            if home_win > away_win + 0.1:
                tip_h += 1
            elif away_win > home_win + 0.1:
                tip_a += 1

        if slot in upset_indices:
            if tip_h != tip_a:
                score_h, score_a = tip_a, tip_h
            else:
                if home_team.elo <= away_team.elo:
                    score_h, score_a = 1, 0
                else:
                    score_h, score_a = 0, 1
        else:
            score_h, score_a = tip_h, tip_a

        # Knockout rounds must have a winner — break draws
        if score_h == score_a:
            home_stronger = home_team.elo >= away_team.elo
            is_upset = slot in upset_indices
            if home_stronger != is_upset:
                score_h += 1
            else:
                score_a += 1

        m.score_home = score_h
        m.score_away = score_a
        m.status = "FINISHED"
        newly_finished.append(m)

    db.commit()
    _apply_elo_and_predictions(db, newly_finished, generate_predictions)
    return len(newly_finished), ""


# ── fake knockout rounds (dev/test) ──────────────────────────────────────────

def _get_round_winners(db: Session, stage: str) -> list[int]:
    """Team IDs of winners from all finished matches of a stage."""
    winners = []
    for m in (db.query(models.WmtMatch)
              .filter(models.WmtMatch.stage == stage, models.WmtMatch.status == "FINISHED")
              .all()):
        if m.score_home is None or m.score_away is None:
            continue
        if m.score_home > m.score_away and m.home_team_id:
            winners.append(m.home_team_id)
        elif m.score_away > m.score_home and m.away_team_id:
            winners.append(m.away_team_id)
    return winners


def _get_round_losers(db: Session, stage: str) -> list[int]:
    """Team IDs of losers from all finished matches of a stage."""
    losers = []
    for m in (db.query(models.WmtMatch)
              .filter(models.WmtMatch.stage == stage, models.WmtMatch.status == "FINISHED")
              .all()):
        if m.score_home is None or m.score_away is None:
            continue
        if m.score_home > m.score_away and m.away_team_id:
            losers.append(m.away_team_id)
        elif m.score_away > m.score_home and m.home_team_id:
            losers.append(m.home_team_id)
    return losers


def _auto_assign_next_round(db: Session) -> None:
    """When a round is fully complete, assign qualified teams to the next round's empty slots.
    Called from _apply_elo_and_predictions so predictions are generated for newly-assigned matches.
    """
    all_teams = {t.id: t for t in db.query(models.WmtTeam).all()}

    def _stage_fully_done(stage: str) -> bool:
        total = db.query(models.WmtMatch).filter(
            models.WmtMatch.stage == stage,
            models.WmtMatch.home_team_id.isnot(None),
        ).count()
        finished = db.query(models.WmtMatch).filter(
            models.WmtMatch.stage == stage,
            models.WmtMatch.status == "FINISHED",
        ).count()
        return total > 0 and finished >= total

    def _has_empty_slots(stage: str) -> bool:
        return db.query(models.WmtMatch).filter(
            models.WmtMatch.stage == stage,
            models.WmtMatch.home_team_id.is_(None),
        ).count() > 0

    def _fill_slots(stage: str, team_ids: list[int]) -> None:
        slots = (
            db.query(models.WmtMatch)
            .filter(models.WmtMatch.stage == stage, models.WmtMatch.home_team_id.is_(None))
            .order_by(models.WmtMatch.utc_date)
            .all()
        )
        if not slots or len(team_ids) < len(slots) * 2:
            return
        # Pair strongest vs weakest by ELO (same logic as do_fake_rd32 / do_fake_knockout_round)
        sorted_ids = sorted(
            team_ids, key=lambda t: -(all_teams[t].elo if all_teams.get(t) else DEFAULT_ELO)
        )
        n = len(slots)
        for i, m in enumerate(slots):
            m.home_team_id = sorted_ids[i]
            m.away_team_id = sorted_ids[2 * n - 1 - i]
        db.commit()

    # ── Rd.32: assign from completed group stage ──────────────────────────────
    if _has_empty_slots("LAST_32"):
        total_grp = db.query(models.WmtMatch).filter(
            models.WmtMatch.stage == "GROUP_STAGE",
            models.WmtMatch.home_team_id.isnot(None),
        ).count()
        done_grp = db.query(models.WmtMatch).filter(
            models.WmtMatch.stage == "GROUP_STAGE",
            models.WmtMatch.status == "FINISHED",
        ).count()
        if total_grp > 0 and done_grp >= total_grp:
            standings = _compute_group_standings(db)
            if len(standings) >= 12:
                qualifiers, third_pool = [], []
                for group in sorted(standings.keys()):
                    table = standings[group]
                    if len(table) >= 1: qualifiers.append(table[0]["team_id"])
                    if len(table) >= 2: qualifiers.append(table[1]["team_id"])
                    if len(table) >= 3:
                        t = table[2]
                        third_pool.append((t["pts"], t["gd"], t["gf"], t["team_id"]))
                third_pool.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
                qualifiers.extend(t[3] for t in third_pool[:8])
                if len(qualifiers) >= 32:
                    _fill_slots("LAST_32", qualifiers[:32])

    # ── Subsequent KO rounds from previous round winners / losers ─────────────
    ko_chain = [
        ("LAST_32",        "LAST_16",        False),
        ("LAST_16",        "QUARTER_FINALS", False),
        ("QUARTER_FINALS", "SEMI_FINALS",    False),
        ("SEMI_FINALS",    "FINAL",          False),
        ("SEMI_FINALS",    "THIRD_PLACE",    True),
    ]
    for prev_stage, next_stage, use_losers in ko_chain:
        if not _has_empty_slots(next_stage):
            continue
        if not _stage_fully_done(prev_stage):
            continue
        team_ids = _get_round_losers(db, prev_stage) if use_losers else _get_round_winners(db, prev_stage)
        _fill_slots(next_stage, team_ids)


def do_fake_knockout_round(
    db: Session, stage: str, n_upsets: int, prev_stage: str = "",
    generate_predictions: bool = True,
) -> tuple[int, str]:
    """
    Fake results for a knockout stage round.
    Teams are taken from prev_stage winners (or losers for THIRD_PLACE) if slots are empty.
    Draws are never produced (knockout must have a winner).
    After SEMI_FINALS, auto-assigns losers to the THIRD_PLACE match.
    """
    round_matches = (
        db.query(models.WmtMatch)
        .filter(models.WmtMatch.stage == stage, models.WmtMatch.status != "FINISHED")
        .order_by(models.WmtMatch.utc_date)
        .all()
    )
    if not round_matches:
        return 0, f"Keine ausstehenden {stage}-Spiele gefunden."

    needs_assignment = any(not m.home_team_id or not m.away_team_id for m in round_matches)
    if needs_assignment and prev_stage:
        if stage == "THIRD_PLACE":
            candidates = _get_round_losers(db, prev_stage)
        else:
            candidates = _get_round_winners(db, prev_stage)

        if len(candidates) < len(round_matches) * 2:
            return 0, (
                f"Nicht genug Qualifikanten ({len(candidates)}) für "
                f"{len(round_matches)} Spiele (Vorrunde: {prev_stage})."
            )

        all_t = {t.id: t for t in db.query(models.WmtTeam).all()}
        candidates.sort(key=lambda tid: -(all_t[tid].elo if all_t.get(tid) else DEFAULT_ELO))
        n = len(round_matches)
        pairs = [(candidates[i], candidates[2 * n - 1 - i]) for i in range(n)]
        for m, (h_id, a_id) in zip(round_matches, pairs):
            m.home_team_id = h_id
            m.away_team_id = a_id
        db.commit()

    all_teams = {t.id: t for t in db.query(models.WmtTeam).all()}

    def elo_gap(m: models.WmtMatch) -> float:
        h = all_teams.get(m.home_team_id)
        a = all_teams.get(m.away_team_id)
        return abs(h.elo - a.elo) if h and a else 0.0

    upset_ids = {m.id for m in sorted(round_matches, key=elo_gap, reverse=True)[:n_upsets]}

    newly_finished: list[models.WmtMatch] = []
    for m in round_matches:
        home = all_teams.get(m.home_team_id)
        away = all_teams.get(m.away_team_id)
        if not home or not away:
            continue
        home_win, _, away_win = elo_to_win_prob(home.elo, away.elo)
        home_xg, away_xg = elo_to_expected_goals(home.elo, away.elo)
        tip_h = max(0, round(home_xg))
        tip_a = max(0, round(away_xg))
        if tip_h == tip_a:
            if home_win > away_win + 0.1:
                tip_h += 1
            elif away_win > home_win + 0.1:
                tip_a += 1

        if m.id in upset_ids:
            if tip_h != tip_a:
                score_h, score_a = tip_a, tip_h
            else:
                score_h, score_a = (1, 0) if home.elo <= away.elo else (0, 1)
        else:
            score_h, score_a = tip_h, tip_a

        # Knockout rounds must have a winner — break draws
        if score_h == score_a:
            home_stronger = home.elo >= away.elo
            is_upset = m.id in upset_ids
            if home_stronger != is_upset:
                score_h += 1
            else:
                score_a += 1

        m.score_home = score_h
        m.score_away = score_a
        m.status = "FINISHED"
        newly_finished.append(m)

    db.commit()

    # After SEMI_FINALS: assign losers to THIRD_PLACE slots
    if stage == "SEMI_FINALS" and newly_finished:
        tp = db.query(models.WmtMatch).filter(models.WmtMatch.stage == "THIRD_PLACE").first()
        if tp and (not tp.home_team_id or not tp.away_team_id):
            losers = [
                (m.away_team_id if (m.score_home or 0) > (m.score_away or 0) else m.home_team_id)
                for m in newly_finished
                if m.score_home is not None and m.score_home != m.score_away
            ]
            if len(losers) >= 2:
                tp.home_team_id = losers[0]
                tp.away_team_id = losers[1]
                db.commit()

    _apply_elo_and_predictions(db, newly_finished, generate_predictions)
    return len(newly_finished), ""


def do_fake_all(db: Session) -> tuple[int, str]:
    """Alle Turnierphasen MD1–Finale in einem Schritt faken.
    ELO-Updates laufen zwischen den Phasen; Prognosen werden nur einmal am Ende
    generiert (no-op, da keine SCHEDULED-Spiele mehr übrig bleiben).
    """
    total = 0
    pipeline = [
        (do_fake_group_md,      (db, 1, 3)),
        (do_fake_group_md,      (db, 2, 5)),
        (do_fake_group_md,      (db, 3, 7)),
        (do_fake_rd32,          (db,)),
        (do_fake_knockout_round, (db, "LAST_16",        3, "LAST_32")),
        (do_fake_knockout_round, (db, "QUARTER_FINALS", 2, "LAST_16")),
        (do_fake_knockout_round, (db, "SEMI_FINALS",    1, "QUARTER_FINALS")),
        (do_fake_knockout_round, (db, "THIRD_PLACE",    0, "SEMI_FINALS")),
        (do_fake_knockout_round, (db, "FINAL",          0, "SEMI_FINALS")),
    ]
    for fn, args in pipeline:
        n, _ = fn(*args, generate_predictions=False)
        total += n
    return total, f"Alle {total} Spiele gefakt (Gesamtturnier)."


# ── helpers for API response assembly ────────────────────────────────────────

def _team_out(team: Optional[models.WmtTeam]) -> Optional[schemas.WmtTeamOut]:
    if not team:
        return None
    return schemas.WmtTeamOut(
        id=team.id,
        api_id=team.api_id,
        name=team.name,
        short_name=team.short_name,
        tla=team.tla,
        elo=team.elo,
        matches_played=team.matches_played or 0,
    )


def _pred_out(pred: Optional[models.WmtPrediction]) -> Optional[schemas.WmtPredictionOut]:
    if not pred:
        return None
    return schemas.WmtPredictionOut(
        id=pred.id,
        match_id=pred.match_id,
        created_at=pred.created_at,
        home_win_prob=pred.home_win_prob,
        draw_prob=pred.draw_prob,
        away_win_prob=pred.away_win_prob,
        pred_home_goals=pred.pred_home_goals,
        pred_away_goals=pred.pred_away_goals,
        home_elo=pred.home_elo,
        away_elo=pred.away_elo,
        reasoning=pred.reasoning,
    )


def _match_out(match: models.WmtMatch, db: Session) -> schemas.WmtMatchOut:
    home = db.get(models.WmtTeam, match.home_team_id) if match.home_team_id else None
    away = db.get(models.WmtTeam, match.away_team_id) if match.away_team_id else None
    pred = (
        db.query(models.WmtPrediction)
        .filter_by(match_id=match.id)
        .order_by(models.WmtPrediction.created_at.desc())
        .first()
    )
    return _assemble_match_out(match, home, away, pred)


def _assemble_match_out(
    match: models.WmtMatch,
    home: Optional[models.WmtTeam],
    away: Optional[models.WmtTeam],
    pred: Optional[models.WmtPrediction],
    all_preds: Optional[list[models.WmtPrediction]] = None,
) -> schemas.WmtMatchOut:
    return schemas.WmtMatchOut(
        id=match.id,
        api_id=match.api_id,
        matchday=match.matchday,
        stage=match.stage,
        group_name=match.group_name,
        utc_date=match.utc_date,
        status=match.status,
        score_home=match.score_home,
        score_away=match.score_away,
        home_team=_team_out(home),
        away_team=_team_out(away),
        prediction=_pred_out(pred),
        predictions=[_pred_out(p) for p in (all_preds or ([pred] if pred else []))],
    )


# ── API endpoints ─────────────────────────────────────────────────────────────

def _md_done(db: Session, matchday: int) -> bool:
    total = db.query(models.WmtMatch).filter(
        models.WmtMatch.stage == "GROUP_STAGE",
        models.WmtMatch.matchday == matchday,
        models.WmtMatch.home_team_id.isnot(None),
    ).count()
    finished = db.query(models.WmtMatch).filter(
        models.WmtMatch.stage == "GROUP_STAGE",
        models.WmtMatch.matchday == matchday,
        models.WmtMatch.status == "FINISHED",
    ).count()
    return total > 0 and finished >= total


def _rd32_done(db: Session) -> bool:
    total = db.query(models.WmtMatch).filter(
        models.WmtMatch.stage == "LAST_32",
    ).count()
    finished = db.query(models.WmtMatch).filter(
        models.WmtMatch.stage == "LAST_32",
        models.WmtMatch.status == "FINISHED",
    ).count()
    return total > 0 and finished >= total


def _is_calibrated(db: Session) -> bool:
    """True wenn ELO-Werte merklich von INITIAL_ELO abweichen (Warmup wurde durchgeführt)."""
    teams = db.query(models.WmtTeam).filter(models.WmtTeam.tla.isnot(None)).all()
    if not teams:
        return False
    total_diff, count = 0.0, 0
    for t in teams:
        initial = INITIAL_ELO.get(t.tla)
        if initial is not None:
            total_diff += abs(t.elo - initial)
            count += 1
    return count > 0 and (total_diff / count) > 10.0


@router.get("/status", response_model=schemas.WmtStatusOut)
def get_status(db: Session = Depends(get_db)):
    return schemas.WmtStatusOut(
        match_count=db.query(models.WmtMatch).count(),
        team_count=db.query(models.WmtTeam).count(),
        prediction_count=db.query(models.WmtPrediction).count(),
        calibrated=_is_calibrated(db),
        md1_done=_md_done(db, 1),
        md2_done=_md_done(db, 2),
        md3_done=_md_done(db, 3),
        rd32_done=_rd32_done(db),
    )


@router.get("/matches", response_model=list[schemas.WmtMatchOut])
def list_matches(db: Session = Depends(get_db)):
    matches = (
        db.query(models.WmtMatch)
        .order_by(models.WmtMatch.utc_date)
        .all()
    )
    # Bulk-load teams and all predictions (avoids N+1: 3 queries total)
    teams = {t.id: t for t in db.query(models.WmtTeam).all()}
    all_preds_by_match: dict[int, list[models.WmtPrediction]] = {}
    for p in db.query(models.WmtPrediction).order_by(models.WmtPrediction.created_at.desc()).all():
        all_preds_by_match.setdefault(p.match_id, []).append(p)
    return [
        _assemble_match_out(
            m,
            teams.get(m.home_team_id) if m.home_team_id else None,
            teams.get(m.away_team_id) if m.away_team_id else None,
            all_preds_by_match.get(m.id, [None])[0],
            all_preds_by_match.get(m.id, []),
        )
        for m in matches
    ]


@router.get("/matches/{mid}/predictions", response_model=list[schemas.WmtPredictionOut])
def match_predictions(mid: int, db: Session = Depends(get_db)):
    return (
        db.query(models.WmtPrediction)
        .filter_by(match_id=mid)
        .order_by(models.WmtPrediction.created_at.desc())
        .all()
    )


@router.get("/teams", response_model=list[schemas.WmtTeamOut])
def list_teams(db: Session = Depends(get_db)):
    return (
        db.query(models.WmtTeam)
        .order_by(models.WmtTeam.elo.desc())
        .all()
    )


@router.get("/summaries", response_model=list[schemas.WmtSummaryOut])
def list_summaries(db: Session = Depends(get_db)):
    rows = (
        db.query(models.WmtSummary)
        .order_by(models.WmtSummary.date.desc())
        .all()
    )
    return [
        schemas.WmtSummaryOut(
            id=r.id,
            date=r.date.isoformat(),
            content=r.content,
            matches_count=r.matches_count,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("/refresh", response_model=schemas.WmtRefreshOut)
def manual_refresh(db: Session = Depends(get_db)):
    n, err_msg = do_refresh(db)
    if err_msg:
        return schemas.WmtRefreshOut(message=err_msg, updated=0)
    return schemas.WmtRefreshOut(
        message=f"Aktualisierung abgeschlossen. {n} Spiel{'e' if n != 1 else ''} neu/aktualisiert.",
        updated=n,
    )


@router.post("/summary/generate", response_model=schemas.WmtRefreshOut)
def generate_summary_now(db: Session = Depends(get_db)):
    yesterday = date.today() - timedelta(days=1)
    content = do_generate_summary(db, yesterday)
    if content:
        return schemas.WmtRefreshOut(message="Zusammenfassung erstellt.", updated=1)
    return schemas.WmtRefreshOut(message="Keine abgeschlossenen Spiele für gestern gefunden.", updated=0)


@router.post("/summary/generate/{target_date}", response_model=schemas.WmtRefreshOut)
def generate_summary_for_date(target_date: str, db: Session = Depends(get_db)):
    try:
        parsed = date.fromisoformat(target_date)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Ungültiges Datumsformat: {target_date}")
    content = do_generate_summary(db, parsed)
    if content:
        return schemas.WmtRefreshOut(message=f"Morgenbericht für {target_date} erstellt.", updated=1)
    return schemas.WmtRefreshOut(message=f"Keine abgeschlossenen Spiele am {target_date} gefunden.", updated=0)


@router.get("/bonus", response_model=schemas.WmtBonusPredictionOut)
def get_bonus(db: Session = Depends(get_db)):
    record = (
        db.query(models.WmtBonusPrediction)
        .order_by(models.WmtBonusPrediction.generated_at.desc())
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Noch keine Bonus-Prognose generiert.")
    return record


@router.post("/bonus/generate", response_model=schemas.WmtRefreshOut)
def generate_bonus(db: Session = Depends(get_db)):
    result = do_generate_bonus(db)
    if result is None:
        return schemas.WmtRefreshOut(
            message="Keine Spielplan-Daten gefunden. Bitte zuerst ↻ klicken um Spielplan zu laden.",
            updated=0,
        )
    return schemas.WmtRefreshOut(
        message=f"Bonus-Prognose erstellt ({result.n_simulations:,} Simulationen).",
        updated=1,
    )


@router.post("/warmup", response_model=schemas.WmtWarmupOut)
def historical_warmup(db: Session = Depends(get_db)):
    result = do_historical_warmup(db)
    return schemas.WmtWarmupOut(**result)


@router.post("/clear", response_model=schemas.WmtRefreshOut)
def clear_data(db: Session = Depends(get_db)):
    """Alle WMT-Daten aus der Datenbank löschen."""
    db.query(models.WmtBonusPrediction).delete()
    db.query(models.WmtPrediction).delete()
    db.query(models.WmtSummary).delete()
    db.query(models.WmtMatch).delete()
    db.query(models.WmtTeam).delete()
    db.commit()
    return schemas.WmtRefreshOut(message="Alle WMT-Daten gelöscht.", updated=0)


@router.post("/debug/fake-md1", response_model=schemas.WmtRefreshOut)
def fake_md1_results(db: Session = Depends(get_db)):
    """Fake-Ergebnisse für alle ausstehenden MD1-Spiele setzen (nur für Tests)."""
    n, err = do_fake_md1(db)
    if err:
        return schemas.WmtRefreshOut(message=err, updated=0)
    return schemas.WmtRefreshOut(
        message=f"Fake-Ergebnisse gesetzt: {n} MD1-Spiel{'e' if n != 1 else ''} abgeschlossen.",
        updated=n,
    )


@router.post("/debug/fake-md2", response_model=schemas.WmtRefreshOut)
def fake_md2_results(db: Session = Depends(get_db)):
    n, err = do_fake_group_md(db, 2, 5)
    if err:
        return schemas.WmtRefreshOut(message=err, updated=0)
    return schemas.WmtRefreshOut(
        message=f"Fake-Ergebnisse gesetzt: {n} MD2-Spiel{'e' if n != 1 else ''} abgeschlossen.",
        updated=n,
    )


@router.post("/debug/fake-md3", response_model=schemas.WmtRefreshOut)
def fake_md3_results(db: Session = Depends(get_db)):
    n, err = do_fake_group_md(db, 3, 7)
    if err:
        return schemas.WmtRefreshOut(message=err, updated=0)
    return schemas.WmtRefreshOut(
        message=f"Fake-Ergebnisse gesetzt: {n} MD3-Spiel{'e' if n != 1 else ''} abgeschlossen.",
        updated=n,
    )


@router.post("/debug/fake-rd32", response_model=schemas.WmtRefreshOut)
def fake_rd32_results(db: Session = Depends(get_db)):
    n, err = do_fake_rd32(db)
    if err:
        return schemas.WmtRefreshOut(message=err, updated=0)
    return schemas.WmtRefreshOut(
        message=f"Fake-Ergebnisse gesetzt: {n} Rd.32-Spiel{'e' if n != 1 else ''} abgeschlossen.",
        updated=n,
    )


@router.post("/debug/fake-last16", response_model=schemas.WmtRefreshOut)
def fake_last16_results(db: Session = Depends(get_db)):
    n, err = do_fake_knockout_round(db, "LAST_16", 3, "LAST_32")
    if err:
        return schemas.WmtRefreshOut(message=err, updated=0)
    return schemas.WmtRefreshOut(
        message=f"Fake-Ergebnisse gesetzt: {n} Achtelfinale-Spiel{'e' if n != 1 else ''} abgeschlossen.",
        updated=n,
    )


@router.post("/debug/fake-qf", response_model=schemas.WmtRefreshOut)
def fake_qf_results(db: Session = Depends(get_db)):
    n, err = do_fake_knockout_round(db, "QUARTER_FINALS", 2, "LAST_16")
    if err:
        return schemas.WmtRefreshOut(message=err, updated=0)
    return schemas.WmtRefreshOut(
        message=f"Fake-Ergebnisse gesetzt: {n} Viertelfinale-Spiel{'e' if n != 1 else ''} abgeschlossen.",
        updated=n,
    )


@router.post("/debug/fake-sf", response_model=schemas.WmtRefreshOut)
def fake_sf_results(db: Session = Depends(get_db)):
    n, err = do_fake_knockout_round(db, "SEMI_FINALS", 1, "QUARTER_FINALS")
    if err:
        return schemas.WmtRefreshOut(message=err, updated=0)
    return schemas.WmtRefreshOut(
        message=f"Fake-Ergebnisse gesetzt: {n} Halbfinale-Spiel{'e' if n != 1 else ''} abgeschlossen.",
        updated=n,
    )


@router.post("/debug/fake-tp", response_model=schemas.WmtRefreshOut)
def fake_tp_results(db: Session = Depends(get_db)):
    n, err = do_fake_knockout_round(db, "THIRD_PLACE", 0, "SEMI_FINALS")
    if err:
        return schemas.WmtRefreshOut(message=err, updated=0)
    return schemas.WmtRefreshOut(
        message=f"Fake-Ergebnisse gesetzt: Spiel um Platz 3 abgeschlossen.",
        updated=n,
    )


@router.post("/debug/fake-final", response_model=schemas.WmtRefreshOut)
def fake_final_results(db: Session = Depends(get_db)):
    n, err = do_fake_knockout_round(db, "FINAL", 0, "SEMI_FINALS")
    if err:
        return schemas.WmtRefreshOut(message=err, updated=0)
    return schemas.WmtRefreshOut(
        message=f"Fake-Ergebnisse gesetzt: Finale abgeschlossen.",
        updated=n,
    )


@router.post("/debug/fake-all", response_model=schemas.WmtRefreshOut)
def fake_all_results(db: Session = Depends(get_db)):
    """Alle Phasen MD1–Finale in einem Schritt faken (nur für Tests)."""
    n, msg = do_fake_all(db)
    return schemas.WmtRefreshOut(message=msg, updated=n)
