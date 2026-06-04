#!/usr/bin/env python3
"""Shared audit trail helper for the STR listing pipeline.

Each source CSV gets ONE audit file in outputs/audit_trail/.
Every pipeline step appends a new section to that file.

Audit file naming:   <base_stem>_audit.md
  e.g.  "1-20 Units (Multiple States)_audit.md"

Usage (in any pipeline script):
    from pipeline_audit import AuditLog
    audit = AuditLog("1-20 Units (Multiple States)", audit_dir)
    audit.append_step(
        step_number=1,
        step_name="Filter — python_listing_filter_01",
        details={
            "Source rows": 24244,
            "Rows after filter": 490,
            "Output file": "01_filtered/1-20 Units (Multiple States) 2026-05-28.csv",
        }
    )
"""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path


AUDIT_DIR = Path(
    "/Users/kristapsjansons/Documents_Local/Clone - Antigravity/AI SALES/outputs/audit_trail"
)


def _sanitise_stem(stem: str) -> str:
    """Strip a trailing YYYY-MM-DD date and clean whitespace."""
    return re.sub(r"\s*\d{4}-\d{2}-\d{2}$", "", stem).strip()


class AuditLog:
    """Append-only audit log for a single source CSV as it moves through the pipeline."""

    def __init__(self, base_stem: str, audit_dir: Path = AUDIT_DIR) -> None:
        """
        Parameters
        ----------
        base_stem:
            The source filename stem *without* date, e.g. "1-20 Units (Multiple States)".
            Dates are stripped automatically if present.
        audit_dir:
            Folder where all audit markdown files live.
        """
        self.base_stem = _sanitise_stem(base_stem)
        self.audit_dir = audit_dir
        self.audit_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.audit_dir / f"{self.base_stem}_audit.md"
        self._ensure_header()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def append_step(
        self,
        step_number: int,
        step_name: str,
        details: dict[str, object],
        notes: str = "",
    ) -> None:
        """Append one pipeline step section to the audit file.

        Parameters
        ----------
        step_number : int
            Pipeline step index (1-4).
        step_name : str
            Human-readable step label, e.g. "Filter — python_listing_filter_01".
        details : dict
            Key/value pairs to display as a bullet list inside the step.
        notes : str, optional
            Any extra free-text notes to add below the detail list.
        """
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        lines: list[str] = [
            "",
            "---",
            "",
            f"## Step {step_number} — {step_name}",
            f"*Run at: {timestamp}*",
            "",
        ]

        for key, value in details.items():
            lines.append(f"- **{key}**: {value}")

        if notes:
            lines += ["", f"> {notes}"]

        lines.append("")

        with self.path.open("a", encoding="utf-8") as f:
            f.write("\n".join(lines))

        print(f"  [audit] Logged Step {step_number} → {self.path.name}")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _ensure_header(self) -> None:
        """Write the document header only if the file does not exist yet."""
        if self.path.exists():
            return
        header = (
            f"# Pipeline Audit Trail\n"
            f"**File**: {self.base_stem}\n"
            f"**Created**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
            f"\nThis log is appended automatically by each pipeline step.\n"
            f"Steps run in order: 01 Filter → 02 Phone Enrichment → 03 Picture Enrichment → 04 Notion Ready\n"
        )
        with self.path.open("w", encoding="utf-8") as f:
            f.write(header)
