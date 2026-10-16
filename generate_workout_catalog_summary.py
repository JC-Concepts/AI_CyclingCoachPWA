#!/usr/bin/env python3
"""Generate a compact selection index from the public WorkoutGenerator catalog."""

import argparse
import json
import math
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


SOURCE_URL = (
    "https://raw.githubusercontent.com/JC-Concepts/WorkoutGenerator/"
    "refs/heads/main/workouts.json"
)
SOURCE_ROOT = "https://raw.githubusercontent.com/JC-Concepts/WorkoutGenerator/refs/heads/main"
FIELDS = (
    "id",
    "name",
    "author",
    "category",
    "subcategory",
    "duration_seconds",
    "duration_category",
    "tss",
    "primary_zone",
    "avg_power",
    "file",
    "description",
)


def fetch_json(url):
    """Fetch JSON from an HTTPS source and report transport or decoding errors."""
    request = Request(url, headers={"User-Agent": "AI_CyclingCoach-catalog-index"})
    try:
        with urlopen(request, timeout=60) as response:
            if response.status != 200:
                raise ValueError(f"Catalog request returned HTTP {response.status}")
            return json.load(response)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise ValueError(f"Unable to fetch valid JSON from {url}: {exc}") from exc


def _is_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return isinstance(value, int) or math.isfinite(value)


def create_summary(catalog):
    """Keep only complete, time-bounded workouts and selection-relevant metadata."""
    if not isinstance(catalog, dict) or not isinstance(catalog.get("workouts"), list):
        raise ValueError("Catalog must be an object with a workouts array")

    summarized = []
    omitted = 0
    for entry in catalog["workouts"]:
        if not isinstance(entry, dict):
            omitted += 1
            continue

        workout_id = entry.get("id")
        name = entry.get("name")
        file_path = entry.get("file")
        duration = entry.get("duration_seconds")
        if (
            not isinstance(workout_id, str)
            or not workout_id.strip()
            or not isinstance(name, str)
            or not name.strip()
            or not isinstance(file_path, str)
            or not file_path.strip()
            or not _is_number(duration)
            or duration < 60
            or duration > 43_200
        ):
            omitted += 1
            continue

        item = []
        for field in FIELDS:
            value = entry.get(field)
            if field == "description":
                if isinstance(value, str) and value.strip():
                    description = " ".join(value.split())
                    item.append(
                        description
                        if len(description) <= 120
                        else description[:117].rstrip() + "..."
                    )
                else:
                    item.append(None)
            elif value is not None and isinstance(value, (str, int, float)):
                item.append(
                    value
                    if not isinstance(value, bool)
                    and (not isinstance(value, float) or math.isfinite(value))
                    else None
                )
            else:
                item.append(None)
        summarized.append(item)

    if not summarized:
        raise ValueError(
            "Catalog contained no workouts with valid IDs, files, and durations"
        )

    duration_index = FIELDS.index("duration_seconds")
    id_index = FIELDS.index("id")
    summarized.sort(key=lambda item: (item[duration_index], item[id_index]))
    return {
        "source": SOURCE_URL,
        "source_version": catalog.get("version"),
        "source_last_updated": catalog.get("lastUpdated"),
        "count": len(summarized),
        "omitted_count": omitted,
        "fields": list(FIELDS),
        "workouts": summarized,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        default=SOURCE_URL,
        help="Catalog JSON URL or local JSON file (default: upstream catalog)",
    )
    parser.add_argument(
        "--output",
        default="workout_catalog_summary.json",
        help="Output summary path",
    )
    args = parser.parse_args()

    source_path = Path(args.source)
    if args.source.startswith(("http://", "https://")):
        catalog = fetch_json(args.source)
    else:
        with source_path.open(encoding="utf-8") as source_file:
            catalog = json.load(source_file)

    summary = create_summary(catalog)
    output_path = Path(args.output)
    output_path.write_text(
        json.dumps(summary, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {summary['count']} workouts "
        f"({summary['omitted_count']} omitted) to {output_path}"
    )


if __name__ == "__main__":
    main()
