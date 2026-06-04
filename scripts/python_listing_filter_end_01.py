#!/usr/bin/env python3
"""Post-process filtered STR listing CSVs: copy original as _w_empty_rows, deduplicate, then keep only phone-enriched rows."""

from __future__ import annotations

import argparse
import csv
import re
import shutil
import sys
from datetime import date
from pathlib import Path

# Allow importing sibling scripts/pipeline_audit when run from any cwd
sys.path.insert(0, str(Path(__file__).parent))
from pipeline_audit import AuditLog  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    """Read a CSV file and return (headers, rows)."""
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise ValueError(f"{path} has no header row.")
        headers = list(reader.fieldnames)
        rows = list(reader)
    return headers, rows


def write_csv(path: Path, headers: list[str], rows: list[dict[str, str]]) -> None:
    """Write rows to a CSV file, creating parent directories as needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"  → Saved {len(rows):,} rows to: {path.name}")


def enrichment_score(row: dict[str, str]) -> int:
    """Count non-empty columns — higher score = more enriched."""
    return sum(1 for v in row.values() if str(v).strip())


def is_airbnb(row: dict[str, str]) -> bool:
    url = str(row.get("Listing URL", "")).strip().lower()
    portal = str(row.get("portal", "")).strip().lower()
    return "airbnb" in url or portal == "airbnb"


def dedup_key(row: dict[str, str]) -> tuple[str, str]:
    """Build the deduplication key: (normalised Listing URL, normalised villaName)."""
    url = str(row.get("Listing URL", "")).strip().lower()
    if not url:
        url = (
            str(row.get("Property ID", "")).strip().lower()
            or str(row.get("Airbnb Property ID", "")).strip().lower()
            or str(row.get("Vrbo Property ID", "")).strip().lower()
        )
    villa = str(row.get("villaName", "")).strip().lower()
    return (url, villa)


# ---------------------------------------------------------------------------
# Core steps
# ---------------------------------------------------------------------------

def deduplicate(rows: list[dict[str, str]]) -> tuple[list[dict[str, str]], int]:
    """
    Deduplicate rows sharing the same (Listing URL, villaName) key.

    Tie-breaking priority:
      1. Row with the most non-empty columns (most enriched).
      2. If tied, prefer the row whose Listing URL / portal is Airbnb.
      3. Otherwise keep the first encountered row.

    Returns (deduplicated_rows, number_of_removed_rows).
    """
    groups: dict[tuple[str, str], list[dict[str, str]]] = {}
    for row in rows:
        key = dedup_key(row)
        groups.setdefault(key, []).append(row)

    kept: list[dict[str, str]] = []
    removed_count = 0

    for key, group in groups.items():
        if len(group) == 1:
            kept.append(group[0])
            continue
        # Sort: highest enrichment score first, then Airbnb rows first
        group.sort(key=lambda r: (enrichment_score(r), int(is_airbnb(r))), reverse=True)
        kept.append(group[0])
        removed_count += len(group) - 1

    return kept, removed_count


def filter_no_phone(rows: list[dict[str, str]]) -> tuple[list[dict[str, str]], int]:
    """Remove rows where the 'Phone' column is empty. Returns (kept, removed_count)."""
    kept = [r for r in rows if str(r.get("Phone", "")).strip()]
    removed = len(rows) - len(kept)
    return kept, removed


# ---------------------------------------------------------------------------
# Filename helpers
# ---------------------------------------------------------------------------

def stem_without_date(name: str) -> str:
    """Strip a trailing YYYY-MM-DD date from a filename stem."""
    return re.sub(r"\s*\d{4}-\d{2}-\d{2}$", "", name).strip()


def build_output_path(output_dir: Path, base_stem: str, suffix: str, today: str) -> Path:
    """Construct: <output_dir>/<base_stem><suffix> <today>.csv"""
    return output_dir / f"{base_stem}{suffix} {today}.csv"


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "inputs",
        nargs="+",
        type=Path,
        help="One or more CSV files (or directories containing CSVs) to process.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("/Users/kristapsjansons/Documents_Local/Clone - Antigravity/AI SALES/outputs/04_notion_ready"),
        help="Directory where output files will be written.",
    )
    args = parser.parse_args()

    today = date.today().strftime("%Y-%m-%d")

    # Collect CSV input files
    input_files: list[Path] = []
    for p in args.inputs:
        if p.is_dir():
            input_files.extend(sorted(p.glob("*.csv")))
        elif p.suffix.lower() == ".csv":
            input_files.append(p)
        else:
            print(f"Warning: skipping non-CSV path: {p}", file=sys.stderr)

    if not input_files:
        raise SystemExit("No CSV files found in the provided input path(s).")

    print(f"Files to process: {len(input_files)}")

    grand_total_dupes = 0
    grand_total_no_phone = 0
    grand_total_final = 0

    for input_file in input_files:
        print(f"\n{'=' * 60}")
        print(f"Processing: {input_file.name}")
        print(f"{'=' * 60}")

        headers, rows = read_csv(input_file)
        original_count = len(rows)
        print(f"  Rows loaded          : {original_count:,}")

        base_stem = stem_without_date(input_file.stem)

        # --- Step 1: Copy original file as _w_empty_rows BEFORE any changes ---
        backup_path = build_output_path(args.output_dir, base_stem, "_w_empty_rows", today)
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(input_file, backup_path)
        print(f"  → Backup saved to  : {backup_path.name}")

        # --- Step 2: Deduplicate ---
        deduped_rows, dupes_removed = deduplicate(rows)
        grand_total_dupes += dupes_removed
        print(f"  Duplicate rows removed : {dupes_removed:,}")
        print(f"  Rows after dedup       : {len(deduped_rows):,}")

        # --- Step 3: Remove rows with no Phone ---
        phone_rows, no_phone_removed = filter_no_phone(deduped_rows)
        grand_total_no_phone += no_phone_removed
        grand_total_final += len(phone_rows)
        print(f"  Rows with no Phone removed : {no_phone_removed:,}")
        print(f"  Final rows with Phone      : {len(phone_rows):,}")

        # --- Step 4: Save the enriched (cleaned) file under the original stem name ---
        final_path = build_output_path(args.output_dir, base_stem, "", today)
        write_csv(final_path, headers, phone_rows)

        # --- Audit trail: Step 4 ---
        audit = AuditLog(base_stem)
        audit.append_step(
            step_number=4,
            step_name="Notion Ready — python_listing_filter_end_01",
            details={
                "Input file": input_file.name,
                "Original rows loaded": original_count,
                "Duplicate rows removed": dupes_removed,
                "Rows after dedup": len(deduped_rows),
                "Rows removed (no Phone)": no_phone_removed,
                "Final rows with Phone": len(phone_rows),
                "Backup saved (_w_empty_rows)": backup_path.name,
                "Output file": final_path.name,
            },
        )

        print(
            f"  {input_file.name}: "
            f"{original_count:,} → -{dupes_removed} dupes → -{no_phone_removed} no-phone → {len(phone_rows):,} final"
        )

    print(f"\n{'=' * 60}")
    print("GRAND TOTALS")
    print(f"{'=' * 60}")
    print(f"  Total duplicate rows removed : {grand_total_dupes:,}")
    print(f"  Total no-phone rows removed  : {grand_total_no_phone:,}")
    print(f"  Total final rows kept        : {grand_total_final:,}")
    print(f"  Output directory             : {args.output_dir}")


if __name__ == "__main__":
    main()
