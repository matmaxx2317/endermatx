"""
WMT – WM 2026 Tipp-Assistent
Data source: football-data.org free tier (env: FOOTBALL_DATA_API_KEY)
Prediction model: ELO-based win probabilities + expected goals
"""

import logging
import math
import os
import random
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

FOOTBALL_API_KEY = os.getenv("FOOTBALL_DATA_API_KEY", "")
FOOTBALL_API_BASE = "https://api.football-data.org/v4"

ELO_K = 60          # WC tournament K-factor
WC_AVG_GOALS = 1.35  # average goals per team per WC game


# Initial ELO estimates for likely WC 2026 participants (calibrated ~June 2026)
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
    home_elo: float, away_elo: float, score_home: int, score_away: int
) -> tuple[float, float]:
    expected_home = 1.0 / (1.0 + 10.0 ** ((away_elo - home_elo) / 400.0))
    if score_home > score_away:
        actual_home = 1.0
    elif score_home < score_away:
        actual_home = 0.0
    else:
        actual_home = 0.5
    gd = abs(score_home - score_away)
    gd_mult = 1.0 if gd <= 1 else (1.5 if gd == 2 else (1.75 + (gd - 3) * 0.1))
    delta = ELO_K * gd_mult * (actual_home - expected_home)
    return home_elo + delta, away_elo - delta


def _stage_de(stage: str) -> str:
    # football-data.org v4 uses LAST_16 / LAST_32 for knockout rounds
    mapping = {
        "GROUP_STAGE":    "Gruppenphase",
        "LAST_32":        "Rd. 32",
        "ROUND_OF_32":    "Rd. 32",       # kept as fallback
        "LAST_16":        "Achtelfinale",
        "ROUND_OF_16":    "Achtelfinale",  # kept as fallback
        "QUARTER_FINALS": "Viertelfinale",
        "SEMI_FINALS":    "Halbfinale",
        "THIRD_PLACE":    "Spiel um Platz 3",
        "FINAL":          "Finale",
    }
    return mapping.get(stage, stage.replace("_", " ").title())


def build_reasoning(
    home_name: str, away_name: str, home_tla: str, away_tla: str,
    home_elo: float, away_elo: float,
    home_win: float, draw: float, away_win: float,
    home_xg: float, away_xg: float,
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

    tip_home = max(0, round(home_xg))
    tip_away = max(0, round(away_xg))
    # Avoid draw tips when one team is clearly favored
    if tip_home == tip_away:
        if home_win > away_win + 0.1:
            tip_home += 1
        elif away_win > home_win + 0.1:
            tip_away += 1

    return (
        f"{strength}. "
        f"ELO: {home_tla} {home_elo:.0f} vs. {away_tla} {away_elo:.0f}. "
        f"Gewinnchancen: {home_tla} {home_win*100:.0f}% | "
        f"Remis {draw*100:.0f}% | {away_tla} {away_win*100:.0f}%. "
        f"Empfohlener Tipp: {tip_home}:{tip_away}."
    )


# ── football-data.org helpers ────────────────────────────────────────────────

def _api_headers() -> dict:
    return {"X-Auth-Token": FOOTBALL_API_KEY} if FOOTBALL_API_KEY else {}


def _log_rate_limit(r: httpx.Response) -> None:
    remaining = r.headers.get("X-Requests-Available-Minute")
    reset_at   = r.headers.get("X-RequestCounter-Reset")
    if remaining is not None:
        logger.debug("WMT API: %s requests remaining this minute (resets %s)", remaining, reset_at)


def _fetch_wc_teams() -> Optional[dict]:
    if not FOOTBALL_API_KEY:
        return None
    try:
        with httpx.Client(timeout=20.0) as client:
            r = client.get(
                f"{FOOTBALL_API_BASE}/competitions/WC/teams",
                headers=_api_headers(),
                params={"season": "2026"},
            )
            _log_rate_limit(r)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 429:
                reset_at = r.headers.get("X-RequestCounter-Reset", "unknown")
                logger.warning("WMT teams fetch: rate limit hit, resets at %s", reset_at)
                return None
            logger.warning("WMT teams fetch returned %d: %s", r.status_code, r.text[:200])
    except Exception as exc:
        logger.error("WMT teams fetch error: %s", exc)
    return None


def _fetch_wc_matches() -> Optional[dict]:
    if not FOOTBALL_API_KEY:
        return None
    try:
        with httpx.Client(timeout=20.0) as client:
            r = client.get(
                f"{FOOTBALL_API_BASE}/competitions/WC/matches",
                headers=_api_headers(),
                params={"season": "2026"},
            )
            _log_rate_limit(r)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 429:
                reset_at = r.headers.get("X-RequestCounter-Reset", "unknown")
                logger.warning("WMT matches fetch: rate limit hit, resets at %s", reset_at)
                return None
            logger.warning("WMT matches fetch returned %d: %s", r.status_code, r.text[:200])
    except Exception as exc:
        logger.error("WMT matches fetch error: %s", exc)
    return None


# ── core business logic (sync, runs from scheduler or API endpoint) ──────────

def do_refresh(db: Session) -> int:
    """
    Fetch latest WC 2026 data, upsert teams/matches, update ELO from new results,
    create prediction snapshots for all unplayed matches.
    Returns count of matches inserted or result-updated.
    """
    teams_data  = _fetch_wc_teams()
    matches_data = _fetch_wc_matches()

    if not matches_data:
        if not FOOTBALL_API_KEY:
            logger.warning("WMT: no FOOTBALL_DATA_API_KEY set — skipping refresh")
        return 0

    # ── upsert teams ──────────────────────────────────────────────────────────
    if teams_data:
        for t in teams_data.get("teams", []):
            api_id = t.get("id")
            if not api_id:
                continue
            tla = (t.get("tla") or "").upper().strip()
            team = db.query(models.WmtTeam).filter_by(api_id=api_id).first()
            if not team:
                team = models.WmtTeam(
                    api_id=api_id,
                    name=t.get("name", "Unknown"),
                    short_name=t.get("shortName") or t.get("name"),
                    tla=tla or None,
                    elo=INITIAL_ELO.get(tla, DEFAULT_ELO),
                    matches_played=0,
                )
                db.add(team)
            else:
                team.name = t.get("name", team.name)
                team.short_name = t.get("shortName") or team.short_name
                if not team.tla and tla:
                    team.tla = tla
        db.commit()

    # ── upsert matches + ELO updates ──────────────────────────────────────────
    updated = 0
    newly_finished: list[models.WmtMatch] = []

    for m in matches_data.get("matches", []):
        api_id = m.get("id")
        if not api_id:
            continue
        status = m.get("status", "SCHEDULED")
        home_api_id = (m.get("homeTeam") or {}).get("id")
        away_api_id = (m.get("awayTeam") or {}).get("id")
        ft = (m.get("score") or {}).get("fullTime") or {}
        score_home = ft.get("home")
        score_away = ft.get("away")

        home_team = db.query(models.WmtTeam).filter_by(api_id=home_api_id).first() if home_api_id else None
        away_team = db.query(models.WmtTeam).filter_by(api_id=away_api_id).first() if away_api_id else None

        match = db.query(models.WmtMatch).filter_by(api_id=api_id).first()
        if not match:
            raw_date = m.get("utcDate", "")
            try:
                utc_date = datetime.fromisoformat(raw_date.replace("Z", "+00:00")).replace(tzinfo=None)
            except Exception:
                utc_date = datetime.utcnow()

            # Strip "GROUP_" prefix from group label
            raw_group = m.get("group") or ""
            group_name = raw_group.replace("GROUP_", "") if raw_group else None

            match = models.WmtMatch(
                api_id=api_id,
                matchday=m.get("matchday") or 0,
                stage=m.get("stage", "GROUP_STAGE"),
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

    # ── update ELO for newly finished matches (in chronological order) ────────
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

    # ── create/update predictions for upcoming matches ─────────────────────────
    upcoming = (
        db.query(models.WmtMatch)
        .filter(models.WmtMatch.status.in_(["SCHEDULED", "TIMED"]))
        .all()
    )
    for match in upcoming:
        home = db.get(models.WmtTeam, match.home_team_id) if match.home_team_id else None
        away = db.get(models.WmtTeam, match.away_team_id) if match.away_team_id else None
        if not home or not away:
            continue

        home_win, draw, away_win = elo_to_win_prob(home.elo, away.elo)
        home_xg, away_xg = elo_to_expected_goals(home.elo, away.elo)

        # Only create new snapshot if ELO changed significantly since last prediction
        latest = (
            db.query(models.WmtPrediction)
            .filter_by(match_id=match.id)
            .order_by(models.WmtPrediction.created_at.desc())
            .first()
        )
        if latest:
            if (abs((latest.home_elo or 0) - home.elo) < 5.0 and
                    abs((latest.away_elo or 0) - away.elo) < 5.0):
                continue

        home_tla = home.tla or home.short_name or home.name
        away_tla = away.tla or away.short_name or away.name
        reasoning = build_reasoning(
            home.name, away.name, home_tla, away_tla,
            home.elo, away.elo, home_win, draw, away_win, home_xg, away_xg,
        )
        pred = models.WmtPrediction(
            match_id=match.id,
            home_win_prob=home_win,
            draw_prob=draw,
            away_win_prob=away_win,
            pred_home_goals=home_xg,
            pred_away_goals=away_xg,
            home_elo=home.elo,
            away_elo=away.elo,
            reasoning=reasoning,
        )
        db.add(pred)

    db.commit()
    return updated


def do_generate_summary(db: Session, for_date: Optional[date] = None) -> str:
    """Generate and store a morning summary for the given date's finished matches."""
    target = for_date or (date.today() - timedelta(days=1))

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
        db.add(models.WmtSummary(
            date=target,
            content=content,
            matches_count=total,
        ))
    db.commit()
    return content


# ── bonus prediction: Monte Carlo tournament simulation ───────────────────────

# Known top international strikers per team – fallback when API scorer data is missing
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
    """Knuth Poisson sampler."""
    L = math.exp(-max(0.01, min(15.0, lam)))
    k, p = 0, 1.0
    while p > L:
        k += 1
        p *= random.random()
    return k - 1


def _fetch_ec_scorers() -> list[dict]:
    """Fetch Euro 2024 top scorers from football-data.org (free tier)."""
    if not FOOTBALL_API_KEY:
        return []
    try:
        with httpx.Client(timeout=20.0) as client:
            r = client.get(
                f"{FOOTBALL_API_BASE}/competitions/EC/scorers",
                headers=_api_headers(),
                params={"season": "2024", "limit": 20},
            )
            _log_rate_limit(r)
            if r.status_code == 200:
                return r.json().get("scorers", [])
            logger.warning("EC scorers fetch returned %d", r.status_code)
    except Exception as exc:
        logger.error("EC scorers fetch error: %s", exc)
    return []


def _compute_top_scorer(db: Session) -> dict:
    """
    Predict top WC 2026 scorer.
    Uses Euro 2024 scorer data (football-data.org) weighted by team ELO and
    expected tournament depth; falls back to TOP_PLAYERS dict.
    """
    ec_scorers  = _fetch_ec_scorers()
    all_teams   = {t.id: t for t in db.query(models.WmtTeam).all()}
    tla_to_team = {t.tla: t for t in all_teams.values() if t.tla}

    candidates: list[dict] = []

    if ec_scorers:
        best_per_tla: dict[str, dict] = {}
        for s in ec_scorers:
            player = s.get("player") or {}
            team   = s.get("team") or {}
            goals  = s.get("goals") or 0
            tla    = (team.get("tla") or "").upper()
            name   = (player.get("name") or "").strip()
            if not name or not tla or goals == 0:
                continue
            if tla not in best_per_tla or best_per_tla[tla]["goals_src"] < goals:
                best_per_tla[tla] = {
                    "player":    name,
                    "team_name": team.get("shortName") or team.get("name", tla),
                    "tla":       tla,
                    "goals_src": goals,
                    "played":    s.get("playedMatches") or 6,
                    "source":    "EC 2024",
                }
        for tla, data in best_per_tla.items():
            wc_team = tla_to_team.get(tla)
            if not wc_team:
                continue
            rate  = data["goals_src"] / data["played"]
            exp_m = 3.0 + 3.5 * min(1.0, max(0.0, (wc_team.elo - 1600) / 400))
            candidates.append({
                "player": data["player"],
                "team":   wc_team.short_name or wc_team.name,
                "tla":    tla,
                "goals":  round(rate * exp_m, 1),
                "source": data["source"],
                "_score": rate * exp_m,
            })

    # Static fallback for teams not covered by EC 2024 data
    covered = {c["tla"] for c in candidates}
    for tla, (player, rate) in TOP_PLAYERS.items():
        if tla in covered:
            continue
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
    """
    Monte Carlo simulation of WC 2026: group stage + knockout.
    Returns a persisted WmtBonusPrediction, or None if no group data exists.
    """
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

    # Counters
    group_win_count: dict[int, int] = defaultdict(int)
    semi_count:      dict[int, int] = defaultdict(int)
    final_count:     dict[int, int] = defaultdict(int)
    win_count:       dict[int, int] = defaultdict(int)

    for _ in range(n_sims):
        third_pool: list[tuple] = []  # (pts, gd, gf, tid, elo)
        qualifiers: list[tuple] = []  # (tid, elo)

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
                    qualifiers.append((tid, elo))
                elif rank == 1:
                    qualifiers.append((tid, elo))
                elif rank == 2:
                    third_pool.append((pts[tid], gd[tid], gf[tid], tid, elo))

        # Best 8 third-place teams (by points, then GD, then GF)
        third_pool.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
        for _, _, _, tid, elo in third_pool[:8]:
            qualifiers.append((tid, elo))

        if len(qualifiers) < 4:
            continue

        # Random bracket seeding for knockout (avoids deterministic outcomes)
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

    # ── assemble result ───────────────────────────────────────────────────────
    all_ids = list(all_teams.keys())

    group_winners: dict[str, dict] = {}
    for group_name in sorted(group_to_teams.keys()):
        tids = list(group_to_teams[group_name])
        if not tids:
            continue
        best_id = max(tids, key=lambda t: group_win_count.get(t, 0))
        t = all_teams.get(best_id)
        if t:
            group_winners[group_name] = {
                "team": t.short_name or t.name,
                "tla":  t.tla or "?",
                "prob": round(group_win_count.get(best_id, 0) / n_sims, 3),
            }

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
    )


# ── API endpoints ─────────────────────────────────────────────────────────────

@router.get("/matches", response_model=list[schemas.WmtMatchOut])
def list_matches(db: Session = Depends(get_db)):
    matches = (
        db.query(models.WmtMatch)
        .order_by(models.WmtMatch.utc_date)
        .all()
    )
    return [_match_out(m, db) for m in matches]


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
    if not FOOTBALL_API_KEY:
        return schemas.WmtRefreshOut(
            message="Kein API-Schlüssel konfiguriert. Bitte FOOTBALL_DATA_API_KEY als Umgebungsvariable setzen.",
            updated=0,
        )
    n = do_refresh(db)
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
