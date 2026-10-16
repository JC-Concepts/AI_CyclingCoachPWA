#!/usr/bin/env python3
"""Fetch a selected catalog workout and push its structured file to Intervals.icu."""

import argparse
import base64
import json
import math
import os
import re
import sys
from datetime import date
from pathlib import PurePosixPath
from urllib.parse import quote

from generate_workout_catalog_summary import SOURCE_ROOT, fetch_json
from push import IntervalsPush, _output


def _fetch_text(url):
    from urllib.request import Request, urlopen

    request = Request(url, headers={"User-Agent": "AI_CyclingCoach-workout-push"})
    with urlopen(request, timeout=60) as response:
        if response.status != 200:
            raise ValueError(f"Workout file request returned HTTP {response.status}")
        contents = response.read(1_500_001)
        if len(contents) > 1_500_000:
            raise ValueError("Workout file exceeds the 1.5 MB upload limit")
        return contents.decode("utf-8")


def build_workout(
    catalog, workout_id, workout_date, catalog_version, fetch_text=_fetch_text
):
    """Resolve one catalog ID and build the upload payload expected by push.py."""
    if not isinstance(catalog, dict):
        raise ValueError("Catalog must be an object")
    if catalog.get("version") != catalog_version:
        raise ValueError(
            f"Catalog version changed from {catalog_version!r} to "
            f"{catalog.get('version')!r}; refresh the summary and choose again"
        )
    if not isinstance(workout_date, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}", workout_date
    ):
        raise ValueError("date must use YYYY-MM-DD format")
    try:
        date.fromisoformat(workout_date)
    except (TypeError, ValueError) as exc:
        raise ValueError("date must use YYYY-MM-DD format") from exc

    if date.fromisoformat(workout_date) < date.today():
        raise ValueError("workout date must be today or in the future")
    if not re.fullmatch(r"workout_[A-Za-z0-9_-]+", workout_id):
        raise ValueError("workout ID has an invalid format")

    entries = catalog.get("workouts")
    if not isinstance(entries, list):
        raise ValueError("Catalog must contain a workouts array")
    matches = [
        item
        for item in entries
        if isinstance(item, dict) and item.get("id") == workout_id
    ]
    if len(matches) != 1:
        raise ValueError(
            f"Expected one catalog entry for {workout_id}, found {len(matches)}"
        )

    entry = matches[0]
    name = entry.get("name")
    duration_seconds = entry.get("duration_seconds")
    if not isinstance(name, str) or not name.strip():
        raise ValueError(f"Catalog entry {workout_id} has no valid name")
    if (
        isinstance(duration_seconds, bool)
        or not isinstance(duration_seconds, (int, float))
        or (
            isinstance(duration_seconds, float)
            and not math.isfinite(duration_seconds)
        )
        or duration_seconds <= 0
    ):
        raise ValueError(f"Catalog entry {workout_id} has no valid duration")
    file_path = entry.get("file")
    if not isinstance(file_path, str) or not file_path.strip():
        raise ValueError(f"Catalog entry {workout_id} has no workout file")
    posix_path = PurePosixPath(file_path)
    if posix_path.is_absolute() or ".." in posix_path.parts:
        raise ValueError(f"Catalog entry {workout_id} has an unsafe file path")
    extension = posix_path.suffix.lower()
    if extension not in {".zwo", ".xml"}:
        raise ValueError(f"Unsupported workout file type: {extension or '(none)'}")

    file_url = f"{SOURCE_ROOT}/workouts/{quote(file_path, safe='/')}"
    file_contents = fetch_text(file_url)
    if not file_contents.strip():
        raise ValueError(f"Workout file for {workout_id} is empty")

    workout = {
        "name": name,
        "date": workout_date,
        "type": "Ride",
        "description": "\n".join(
            part
            for part in (
                f"- Catalog workout: {workout_id}",
                f"- {entry['description'].strip()}"
                if isinstance(entry.get("description"), str)
                and entry["description"].strip()
                else "",
            )
            if part
        ),
        "duration_minutes": round(duration_seconds / 60),
        "category": "WORKOUT",
        "indoor": True,
        "filename": posix_path.name,
        "file_contents_base64": base64.b64encode(
            file_contents.encode("utf-8")
        ).decode("ascii"),
        "external_id": f"workout-catalog:{workout_id}:{workout_date}",
    }
    tss = entry.get("tss")
    if (
        isinstance(tss, (int, float))
        and not isinstance(tss, bool)
        and (not isinstance(tss, float) or math.isfinite(tss))
        and 0 <= tss <= 500
    ):
        workout["tss"] = tss
    return workout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workout-id", required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--catalog-version", required=True)
    parser.add_argument("--confirm", action="store_true")
    args = parser.parse_args()

    try:
        catalog = fetch_json(
            "https://raw.githubusercontent.com/JC-Concepts/WorkoutGenerator/"
            "refs/heads/main/workouts.json"
        )
        workout = build_workout(
            catalog, args.workout_id, args.date, args.catalog_version
        )
    except (OSError, ValueError) as exc:
        print(json.dumps({"success": False, "error": str(exc)}))
        sys.exit(1)

    athlete_id = os.environ.get("ATHLETE_ID")
    api_key = os.environ.get("INTERVALS_KEY")
    if not athlete_id or not api_key:
        print(
            json.dumps(
                {
                    "success": False,
                    "error": "ATHLETE_ID and INTERVALS_KEY are required",
                }
            )
        )
        sys.exit(1)

    try:
        pusher = IntervalsPush(athlete_id, api_key)
    except ValueError as exc:
        print(json.dumps({"success": False, "error": str(exc)}))
        sys.exit(1)
    result = (
        pusher.push_workouts([workout])
        if args.confirm
        else pusher.preview_push([workout])
    )
    _output(result)


if __name__ == "__main__":
    main()
