#!/usr/bin/env python3
"""Filter STR listing comparison CSVs into combined Host Unit Count outputs."""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

# Allow importing sibling scripts/pipeline_audit when run from any cwd
sys.path.insert(0, str(Path(__file__).parent))
from pipeline_audit import AuditLog  # noqa: E402


DEFAULT_ADDED_COLUMNS = [
    "Market Average Occupancy",
    "Occupancy Gap",
    "Revenue Potential Gap",
    "Listing URL",
    "Phone",
    "Phone source",
    "Phone confidence",
    "Phone evidence",
    "Phone belongs to",
    "Contact",
    "Website",
    "Email",
    "Social media link",
    "Social media type",
    "villaName",
    "callContent",
    "callOutcome",
    "agentNotes",
    "callSummary",
    "portal",
    "newPhone",
    "newEmail",
    "bookedSlot",
    "availableHours",
    "recentContact",
    "firstContact",
    "currency",
]


def parse_number(value: object) -> float | None:
    """Parse numeric values from plain, currency, percent, and range strings."""
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None

    cleaned = text.replace("$", "").replace(",", "").replace("%", "")
    match = re.search(r"-?\d+(?:\.\d+)?", cleaned)
    if not match:
        return None

    return float(match.group(0))


def format_number(value: float | None, decimals: int = 2) -> str:
    if value is None:
        return ""
    rounded = round(value, decimals)
    if decimals == 0 or rounded.is_integer():
        return str(int(rounded))
    return f"{rounded:.{decimals}f}"


def bedroom_bucket(row: dict[str, str]) -> str:
    bedrooms = parse_number(row.get("Bedrooms"))
    if bedrooms is None:
        return ""
    if bedrooms >= 7:
        return "7+"
    return str(int(bedrooms))


def property_id(row: dict[str, str]) -> str:
    return (
        row.get("Property ID", "").strip()
        or row.get("Airbnb Property ID", "").strip()
        or row.get("Vrbo Property ID", "").strip()
    )


def property_sort_key(row: dict[str, str]) -> tuple[int, object]:
    pid = property_id(row)
    if pid.isdigit():
        return (0, int(pid))
    return (1, pid.lower())


def host_unit_count_bucket(row: dict[str, str]) -> str:
    text = str(row.get("Host Unit Count", "")).strip()
    if not text:
        return ""

    numbers = [int(float(n)) for n in re.findall(r"\d+(?:\.\d+)?", text)]
    if not numbers:
        return ""

    minimum = min(numbers)
    maximum = max(numbers)

    if "+" in text:
        return "21+" if minimum >= 21 else ""

    if minimum >= 1 and maximum <= 20:
        return "1-20"
    if minimum >= 21:
        return "21+"
    return ""


def passes_primary_filters(row: dict[str, str]) -> bool:
    revenue = parse_number(row.get("Revenue"))
    days_available = parse_number(row.get("Days Available"))
    bookings = parse_number(row.get("Number of Bookings"))
    bedrooms = parse_number(row.get("Bedrooms"))

    return (
        revenue is not None
        and revenue >= 100_000
        and days_available is not None
        and days_available >= 90
        and bookings is not None
        and bookings >= 2
        and bedrooms is not None
        and bedrooms >= 5
    )


def detect_portal(listing_url: str) -> str:
    url = listing_url.strip().lower()
    if "airbnb" in url:
        return "airbnb"
    if "vrbo" in url or "homeaway" in url:
        return "vrbo"
    return ""


def add_calculated_fields(rows: list[dict[str, str]]) -> None:
    occupancies_by_bucket: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        bucket = bedroom_bucket(row)
        occupancy = parse_number(row.get("Occupancy"))
        if bucket and occupancy is not None:
            occupancies_by_bucket[bucket].append(occupancy)

    average_by_bucket = {
        bucket: sum(values) / len(values)
        for bucket, values in occupancies_by_bucket.items()
        if values
    }

    for row in rows:
        bucket = bedroom_bucket(row)
        market_average = average_by_bucket.get(bucket)
        occupancy = parse_number(row.get("Occupancy"))
        revenue = parse_number(row.get("Revenue"))
        revenue_potential = parse_number(row.get("Revenue Potential"))

        row["Market Average Occupancy"] = format_number(market_average)
        row["Occupancy Gap"] = format_number(
            None if occupancy is None or market_average is None else occupancy - market_average
        )
        row["Revenue Potential Gap"] = format_number(
            None
            if revenue is None or revenue_potential is None
            else revenue_potential - revenue,
            decimals=0,
        )

        for column in DEFAULT_ADDED_COLUMNS:
            row.setdefault(column, "")

        # Auto-fill derived fields
        row["portal"] = row["portal"] or detect_portal(row.get("Listing URL", ""))
        row["currency"] = row["currency"] or "USD"


def output_headers(source_headers: list[str]) -> list[str]:
    headers = list(source_headers)
    for column in DEFAULT_ADDED_COLUMNS:
        if column not in headers:
            headers.append(column)
    return headers


def write_csv(path: Path, headers: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def merge_headers(base_headers: list[str], new_headers: list[str]) -> list[str]:
    merged = list(base_headers)
    for header in new_headers:
        if header not in merged:
            merged.append(header)
    return merged


def count_states(rows: list[dict[str, str]]) -> Counter[str]:
    return Counter(
        state
        for state in (str(row.get("State", "")).strip() for row in rows)
        if state
    )


def format_state_label(state_counts: Counter[str], fallback_states: set[str]) -> str:
    if state_counts:
        if len(state_counts) == 1:
            return next(iter(state_counts))

        dominant_state, dominant_count = state_counts.most_common(1)[0]
        total_count = sum(state_counts.values())
        if total_count and dominant_count / total_count >= 0.8:
            return dominant_state
        return "Multiple States"

    clean_states = sorted(state for state in fallback_states if state)
    if not clean_states:
        return "Unknown State"
    if len(clean_states) == 1:
        return clean_states[0]
    return "Multiple States"


def process_file(input_path: Path) -> dict[str, object]:
    with input_path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise ValueError(f"{input_path} does not contain a header row")
        source_headers = list(reader.fieldnames)
        source_rows = list(reader)

    filtered_rows = [row for row in source_rows if passes_primary_filters(row)]
    add_calculated_fields(filtered_rows)
    filtered_rows.sort(key=property_sort_key)

    units_1_to_20_rows: list[dict[str, str]] = []
    units_21_plus_rows: list[dict[str, str]] = []
    for row in filtered_rows:
        bucket = host_unit_count_bucket(row)
        if bucket == "1-20":
            units_1_to_20_rows.append(row)
        elif bucket == "21+":
            units_21_plus_rows.append(row)

    headers = output_headers(source_headers)
    states = {str(row.get("State", "")).strip() for row in source_rows}

    return {
        "input": str(input_path),
        "headers": headers,
        "states": states,
        "source_rows": len(source_rows),
        "primary_filtered_rows": len(filtered_rows),
        "units_1_to_20_rows": units_1_to_20_rows,
        "units_21_plus_rows": units_21_plus_rows,
        "units_1_to_20_count": len(units_1_to_20_rows),
        "units_21_plus_count": len(units_21_plus_rows),
    }


def is_filtered_output(path: Path) -> bool:
    name = path.name
    return (
        name.endswith(".primary-filtered.csv")
        or name.endswith(".host-unit-1-20-view.csv")
        or name.startswith("1-20 Units (")
        or name.startswith("21+ Units (")
    )


def collect_input_files(input_paths: list[Path], output_dir: Path | None = None) -> list[Path]:
    files: list[Path] = []
    resolved_output_dir = output_dir.resolve() if output_dir is not None else None
    for input_path in input_paths:
        if input_path.is_dir():
            for candidate in sorted(input_path.rglob("*.csv")):
                if resolved_output_dir is not None and resolved_output_dir in candidate.resolve().parents:
                    continue
                if is_filtered_output(candidate):
                    continue
                files.append(candidate)
        elif input_path.suffix.lower() == ".csv":
            if is_filtered_output(input_path):
                continue
            files.append(input_path)
    return files


def host_sort_key(row: dict[str, str]) -> str:
    return str(row.get("Property Manager/Host", "")).strip().lower()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("/Users/kristapsjansons/Documents_Local/Clone - Antigravity/AI SALES/outputs/01_filtered"),
    )
    args = parser.parse_args()

    input_files = collect_input_files(args.inputs, output_dir=args.output_dir)
    if not input_files:
        raise SystemExit("No CSV files found in the provided input path(s).")

    combined_headers: list[str] = []
    combined_states: set[str] = set()
    combined_units_1_to_20_rows: list[dict[str, str]] = []
    combined_units_21_plus_rows: list[dict[str, str]] = []

    totals = {
        "files_processed": 0,
        "source_rows": 0,
        "primary_filtered_rows": 0,
        "units_1_to_20_count": 0,
        "units_21_plus_count": 0,
    }

    for input_file in input_files:
        summary = process_file(input_file)
        combined_headers = merge_headers(combined_headers, summary["headers"])
        combined_states.update(summary["states"])
        combined_units_1_to_20_rows.extend(summary["units_1_to_20_rows"])
        combined_units_21_plus_rows.extend(summary["units_21_plus_rows"])

        for key, value in summary.items():
            if key in {"headers", "states", "units_1_to_20_rows", "units_21_plus_rows"}:
                continue
            print(f"{key}: {value}")
        print()

        totals["files_processed"] += 1
        totals["source_rows"] += int(summary["source_rows"])
        totals["primary_filtered_rows"] += int(summary["primary_filtered_rows"])
        totals["units_1_to_20_count"] += int(summary["units_1_to_20_count"])
        totals["units_21_plus_count"] += int(summary["units_21_plus_count"])

    combined_units_1_to_20_rows.sort(key=host_sort_key)
    combined_units_21_plus_rows.sort(key=host_sort_key)

    today = date.today().strftime("%Y-%m-%d")
    units_1_to_20_state_label = format_state_label(
        count_states(combined_units_1_to_20_rows),
        combined_states,
    )
    units_21_plus_state_label = format_state_label(
        count_states(combined_units_21_plus_rows),
        combined_states,
    )
    units_1_to_20_output = args.output_dir / f"1-20 Units ({units_1_to_20_state_label}) {today}.csv"
    units_21_plus_output = args.output_dir / f"21+ Units ({units_21_plus_state_label}) {today}.csv"
    write_csv(units_1_to_20_output, combined_headers, combined_units_1_to_20_rows)
    write_csv(units_21_plus_output, combined_headers, combined_units_21_plus_rows)

    for key, value in totals.items():
        print(f"{key}: {value}")
    print(f"units_1_to_20_output: {units_1_to_20_output}")
    print(f"units_21_plus_output: {units_21_plus_output}")

    # --- Audit trail ---
    input_label = " + ".join(str(p) for p in args.inputs)
    for stem, output_path, row_count in [
        (units_1_to_20_state_label, units_1_to_20_output, totals["units_1_to_20_count"]),
        (units_21_plus_state_label, units_21_plus_output, totals["units_21_plus_count"]),
    ]:
        if row_count == 0:
            continue
        friendly_stem = output_path.stem  # e.g. "1-20 Units (Multiple States) 2026-05-28"
        audit = AuditLog(friendly_stem)
        audit.append_step(
            step_number=1,
            step_name="Filter — python_listing_filter_01",
            details={
                "Input source(s)": input_label,
                "Files processed": totals["files_processed"],
                "Total source rows": totals["source_rows"],
                "Rows after primary filter (≥$100k revenue, ≥90 days, ≥2 bookings, ≥5 bedrooms)": totals["primary_filtered_rows"],
                "Rows in this output file": row_count,
                "Output file": str(output_path),
            },
        )


if __name__ == "__main__":
    main()
