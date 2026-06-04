#!/usr/bin/env python3
"""
Manually log a phone or picture enrichment step to the audit trail.

Run this AFTER completing step 2 (phone enrichment) or step 3 (picture enrichment).

Usage examples:
  # After phone enrichment (step 2):
  python3 scripts/log_enrichment_step.py \
      --step 2 \
      --before  "outputs/01_filtered/1-20 Units (Multiple States) 2026-05-28.csv" \
      --after   "outputs/02_phone_enriched/1-20 Units (Multiple States) 2026-05-28.csv"

  # After picture enrichment (step 3):
  python3 scripts/log_enrichment_step.py \
      --step 3 \
      --before  "outputs/02_phone_enriched/1-20 Units (Multiple States) 2026-05-28.csv" \
      --after   "outputs/03_picture_enriched/1-20 Units (Multiple States) 2026-05-28.csv"
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from pipeline_audit import AuditLog  # noqa: E402

STEP_META = {
    2: {
        "name": "Phone Enrichment — phone_enrichment_02",
        "output_folder": "02_phone_enriched",
    },
    3: {
        "name": "Picture Enrichment — picture_enrichment_01",
        "output_folder": "03_picture_enriched",
    },
}


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise ValueError(f"{path} has no header row.")
        headers = list(reader.fieldnames)
        rows = list(reader)
    return headers, rows


def count_with_phone(rows: list[dict[str, str]]) -> int:
    return sum(1 for r in rows if str(r.get("Phone", "")).strip())


def stem_without_date(name: str) -> str:
    return re.sub(r"\s*\d{4}-\d{2}-\d{2}$", "", name).strip()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--step",
        type=int,
        choices=[2, 3],
        required=True,
        help="Pipeline step number: 2 = phone enrichment, 3 = picture enrichment.",
    )
    parser.add_argument(
        "--before",
        type=Path,
        required=True,
        help="Path to the CSV file BEFORE this enrichment step.",
    )
    parser.add_argument(
        "--after",
        type=Path,
        required=True,
        help="Path to the CSV file AFTER this enrichment step.",
    )
    args = parser.parse_args()

    step_info = STEP_META[args.step]

    # Validate files exist
    for label, path in [("--before", args.before), ("--after", args.after)]:
        if not path.exists():
            raise SystemExit(f"Error: {label} file not found: {path}")

    print(f"Reading before file : {args.before.name}")
    _, rows_before = read_csv(args.before)

    print(f"Reading after file  : {args.after.name}")
    _, rows_after = read_csv(args.after)

    phones_before = count_with_phone(rows_before)
    phones_after  = count_with_phone(rows_after)
    new_phones    = phones_after - phones_before
    rows_still_missing = len(rows_after) - phones_after

    print(f"\nResults:")
    print(f"  Total rows             : {len(rows_after):,}")
    print(f"  Had phone before       : {phones_before:,}")
    print(f"  Have phone after       : {phones_after:,}")
    print(f"  New phone numbers added: {new_phones:,}")
    print(f"  Still missing phone    : {rows_still_missing:,}")

    # Write to audit trail
    base_stem = stem_without_date(args.after.stem)
    audit = AuditLog(base_stem)
    audit.append_step(
        step_number=args.step,
        step_name=step_info["name"],
        details={
            "Input file (before)":          args.before.name,
            "Output file (after)":          args.after.name,
            "Total rows":                   len(rows_after),
            "Rows with phone BEFORE step":  phones_before,
            "Rows with phone AFTER step":   phones_after,
            "New phone numbers found":      new_phones,
            "Rows still missing phone":     rows_still_missing,
            "Success rate this step":       f"{(new_phones / max(len(rows_before) - phones_before, 1) * 100):.1f}% of previously empty rows filled",
        },
    )


if __name__ == "__main__":
    main()
