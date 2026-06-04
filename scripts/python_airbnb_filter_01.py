#!/usr/bin/env python3
"""Filter STR listing comparison CSVs into combined Host Unit Count outputs with automated villa name cleaning."""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

# Allow importing sibling scripts/pipeline_audit when run from any cwd
sys.path.insert(0, str(Path(__file__).parent))
from pipeline_audit import AuditLog  # noqa: E402


DEFAULT_ADDED_COLUMNS = [
    "Sales pers.",
    "Outreach Action",
    "listingCount",
    "Message v1",
    "Message v2",
    "Wow'em msg",
    "Outreach Status",
    "Last Contact Date (MM-DD-YY)",
    "Outreach Channel",
    "Follow-Up Date (MM-DD-YY)",
    "Outreach Notes",
    "First contact (mm-dd-yy)",
    "Attempts",
    "Market Avg. Occupancy",
    "Market avg. ADR",
    "Market avg. revenue",
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
    if bedrooms >= 13:
        return "13+"
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
    occupancy = parse_number(row.get("Occupancy"))

    # Exclude listings that are already performing very well (high occupancy + many bookings)
    if (
        occupancy is not None and occupancy > 70
        and bookings is not None and bookings > 10
    ):
        return False

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


def clean_villa_name(title: str) -> str:
    """Algorithmic cleaning of listing title to extract clean villa/property name (Strategy 2)."""
    if not title:
        return ""

    # 1. Split & Truncate at common delimiters like |, -, ;, •, or comma
    for delimiter in [" | ", " - ", " ; ", " • ", " , "]:
        if delimiter in title:
            parts = title.split(delimiter)
            if parts[0].strip():
                title = parts[0]
                break

    for char in ["|", "—", ";", "•"]:
        if char in title:
            parts = title.split(char)
            if parts[0].strip():
                title = parts[0]
                break

    # Clean the string step-by-step
    text = title.strip()
    text = text.strip('"\'')

    # Case-insensitive replacement of common marketing descriptors / adjectives
    words_to_remove = [
        "luxury", "modern", "cozy", "staffed", "superb", "budget", "premium", 
        "exclusive", "stylish", "spacious", "stunning", "private", "urban", 
        "family", "quiet", "best location", "spectacular", "aesthetic", 
        "classic", "traditional", "tropical", "beautiful", "charming", "lovely",
        "amazing", "great", "nice", "awesome", "huge", "large", "grand"
    ]
    
    pattern = re.compile(r'\b(' + '|'.join(words_to_remove) + r')\b', re.IGNORECASE)
    text = pattern.sub("", text)
    
    # Strip bedroom/bathroom capacity descriptors (e.g. "5BR", "5-Bedroom", "6 Bed")
    capacity_pattern = re.compile(r'\b\d+\s*(?:bedroom|bed|br|bdr|bath|ba|rooms|room|pax)?s?\b', re.IGNORECASE)
    text = capacity_pattern.sub("", text)
    
    # Strip common noise phrases
    noise_phrases = [
        r'\bin\s+[a-zA-Z\s]+', 
        r'\bwith\s+WiFi\s+&\s+AC\b',
        r'\bwith\s+WiFi\b',
        r'\bwith\s+AC\b',
        r'\bwith\s+pool\b',
        r'\bw/\s*pool\b',
        r'\bwith\s+Spectacular\s+View\b',
        r'\bwith\s+Private\s+Chef\b',
        r'\bwalk\s+to\s+[a-zA-Z\s]+',
        r'\bclose\s+to\s+[a-zA-Z\s]+',
        r'\bfully\s+serviced\b',
        r'\bfast\s+internet\b',
        r'\bfree\s+rooms\b'
    ]
    for phrase in noise_phrases:
        text = re.sub(phrase, "", text, flags=re.IGNORECASE)
        
    # Clean up punctuation and multiple spaces
    text = re.sub(r'[^\w\s\']', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    
    if not text:
        return "Generic"
        
    # If the clean text is too generic on its own, flag as Generic
    lower_text = text.lower()
    generic_words = {"villa", "estate", "house", "resort", "retreat", "sanctuary", "palace", "homestay", "lodge", "barn", "cabin", "home"}
    if lower_text in generic_words:
        return "Generic"

    text = text.title()
    
    # If it is still too long after cleaning, it's likely a generic title that couldn't be parsed well
    if len(text.split()) > 6:
        return "Generic"
        
    return text


def add_calculated_fields(rows: list[dict[str, str]]) -> None:
    occupancies_by_bucket: dict[str, list[float]] = defaultdict(list)
    adrs_by_bucket: dict[str, list[float]] = defaultdict(list)
    revenues_by_bucket: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        bucket = bedroom_bucket(row)
        occupancy = parse_number(row.get("Occupancy"))
        adr = parse_number(row.get("ADR"))
        revenue = parse_number(row.get("Revenue"))
        if bucket:
            if occupancy is not None:
                occupancies_by_bucket[bucket].append(occupancy)
            if adr is not None:
                adrs_by_bucket[bucket].append(adr)
            if revenue is not None:
                revenues_by_bucket[bucket].append(revenue)

    average_by_bucket = {
        bucket: sum(values) / len(values)
        for bucket, values in occupancies_by_bucket.items()
        if values
    }
    average_adr_by_bucket = {
        bucket: sum(values) / len(values)
        for bucket, values in adrs_by_bucket.items()
        if values
    }
    average_rev_by_bucket = {
        bucket: sum(values) / len(values)
        for bucket, values in revenues_by_bucket.items()
        if values
    }

    for row in rows:
        bucket = bedroom_bucket(row)
        market_average = average_by_bucket.get(bucket)
        market_average_adr = average_adr_by_bucket.get(bucket)
        market_average_rev = average_rev_by_bucket.get(bucket)
        occupancy = parse_number(row.get("Occupancy"))
        revenue = parse_number(row.get("Revenue"))
        revenue_potential = parse_number(row.get("Revenue Potential"))

        row["Market Avg. Occupancy"] = format_number(market_average)
        row["Market avg. ADR"] = format_number(market_average_adr, decimals=0)
        row["Market avg. revenue"] = format_number(market_average_rev, decimals=0)
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
        
        # Check if Bali/Indonesia to set local currency IDR
        country = str(row.get("Country", "")).strip().lower()
        state = str(row.get("State", "")).strip().lower()
        city = str(row.get("City", "")).strip().lower()
        market = str(row.get("AirDNA Market", "")).strip().lower()
        
        is_indonesia = ("indonesia" in country or "bali" in city or "bali" in state or "bali" in market)
        if is_indonesia:
            row["currency"] = row["currency"] or "IDR"
        else:
            row["currency"] = row["currency"] or "IDR"  # default IDR for all markets
        
        # Populate cleaned villaName dynamically using Strategy 2
        row["villaName"] = clean_villa_name(row.get("Title", ""))

        # Reformat Last Update from YYYY-MM-DD to DD-MM-YY
        last_update = row.get("Last Update", "").strip()
        if last_update:
            try:
                dt = datetime.strptime(last_update, "%Y-%m-%d")
                row["Last Update"] = dt.strftime("%d-%m-%y")
            except ValueError:
                try:
                    dt = datetime.strptime(last_update, "%m-%d-%y")
                    row["Last Update"] = dt.strftime("%d-%m-%y")
                except ValueError:
                    pass


def output_headers(source_headers: list[str]) -> list[str]:
    # 1. User's exact front columns
    front_columns = [
        "Sales pers.",
        "Listing URL",
        "Outreach Action",
        "listingCount",
        "Message v1",
        "Message v2",
        "Wow'em msg",
        "Outreach Status",
        "Last Contact Date (MM-DD-YY)",
        "Follow-Up Date (MM-DD-YY)",
        "Outreach Notes",
        "First contact (mm-dd-yy)",
        "Attempts",
        "Occupancy",
        "Market Avg. Occupancy",
        "Occupancy Gap",
        "Overall Rating",
        "Number of Reviews",
        "Revenue Potential Gap",
        "Revenue",
        "Market avg. revenue",
        "Revenue Potential",
        "ADR",
        "Market avg. ADR",
        "Title",
        "Outreach Channel"
    ]
    
    # 2. Combine all columns in order without duplication
    ordered = []
    for col in front_columns:
        if col not in ordered:
            ordered.append(col)
        
    for col in DEFAULT_ADDED_COLUMNS:
        if col not in ordered:
            ordered.append(col)
            
    for col in source_headers:
        if col not in ordered:
            ordered.append(col)
            
    return ordered


def excel_column_letter(col_idx: int) -> str:
    """Convert a 0-indexed column index to an Excel column letter (e.g. 0 -> A, 27 -> AB)."""
    letter = ""
    col_idx += 1  # make it 1-indexed for calculations
    while col_idx > 0:
        col_idx, remainder = divmod(col_idx - 1, 26)
        letter = chr(65 + remainder) + letter
    return letter


def write_csv(path: Path, headers: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    
    # Find column letter for Last Contact Date (MM-DD-YY) dynamically
    try:
        last_contact_idx = headers.index("Last Contact Date (MM-DD-YY)")
        col_letter = excel_column_letter(last_contact_idx)
    except ValueError:
        col_letter = None

    # Populate default tracking values and Excel formulas dynamically
    for idx, row in enumerate(rows):
        row_num = idx + 2  # Excel row index (header is 1, first data row is 2)
        row["Outreach Status"] = row.get("Outreach Status") or "📥 NEW"
        row["Outreach Channel"] = row.get("Outreach Channel") or "AirBnB"
        
        if col_letter:
            row["Follow-Up Date (MM-DD-YY)"] = f'=IF({col_letter}{row_num}="","", {col_letter}{row_num}+3)'
            
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_xlsx(path: Path, headers: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    import openpyxl
    from openpyxl.worksheet.datavalidation import DataValidation
    
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Listings"
    
    # Write headers
    ws.append(headers)
    
    # Find column letter for Last Contact Date (MM-DD-YY) dynamically
    try:
        last_contact_idx = headers.index("Last Contact Date (MM-DD-YY)")
        col_letter = excel_column_letter(last_contact_idx)
    except ValueError:
        col_letter = None

    # Write rows
    for idx, row in enumerate(rows):
        row_num = idx + 2
        row["Outreach Status"] = row.get("Outreach Status") or "📥 NEW"
        row["Outreach Channel"] = row.get("Outreach Channel") or "AirBnB"
        
        row_data = []
        for h in headers:
            if h == "Follow-Up Date (MM-DD-YY)" and col_letter:
                row_data.append(f'=IF({col_letter}{row_num}="","", {col_letter}{row_num}+3)')
            else:
                row_data.append(row.get(h, ""))
        ws.append(row_data)

    # Set up dropdown lists (extended to 1000 extra rows for user additions)
    num_rows = max(len(rows) + 1000, 1000)
    
    def add_dropdown(col_name: str, options: list[str]):
        try:
            col_idx = headers.index(col_name)
            letter = excel_column_letter(col_idx)
            formula = f'"{",".join(options)}"'
            dv = DataValidation(type="list", formula1=formula, allow_blank=True)
            ws.add_data_validation(dv)
            dv.add(f"{letter}2:{letter}{num_rows}")
        except ValueError:
            pass

    add_dropdown("Outreach Action", ["⚪️ SEND SINGLE", "🟢 SEND COMBINED", "🔴 DUPLICATE"])
    add_dropdown("Outreach Status", ["📥 NEW", "⏳ IN PROGRESS", "✅ CONTACTED", "💬 REPLIED", "📅 BOOKED", "❌ REJECTED", "🚫 INVALID"])
    add_dropdown("Outreach Channel", ["AirBnB", "WhatsApp", "Email", "Instagram", "Facebook", "Call", "SMS"])
    add_dropdown("Phone confidence", ["High", "Medium", "Low"])
    add_dropdown("Phone belongs to", ["property", "manager", "unknown"])
    add_dropdown("Attempts", ["1", "2", "3", "4", "5", "6", "7+"])
    
    # Auto-fit column widths
    for col in ws.columns:
        max_len = 0
        col_letter = openpyxl.utils.get_column_letter(col[0].column)
        for cell in col[:20]:
            val_str = str(cell.value or '')
            if val_str.startswith('='):
                continue
            if len(val_str) > max_len:
                max_len = len(val_str)
        ws.column_dimensions[col_letter].width = max(min(max_len + 3, 40), 10)

    # Specific width overrides for wider columns
    for col_name, width in [
        ("Listing URL", 30),
        ("Message v1", 50),
        ("Message v2", 50),
        ("Wow'em msg", 50),
        ("outreachMessage", 50),
        ("Message 1", 50),
        ("Title", 30),
        ("Outreach Notes", 30)
    ]:
        try:
            col_idx = headers.index(col_name)
            letter = excel_column_letter(col_idx)
            ws.column_dimensions[letter].width = width
        except ValueError:
            pass
            
    # Enable autofilter for all columns across the data range
    ws.auto_filter.ref = ws.dimensions
    
    # Freeze the header row (row 1)
    ws.freeze_panes = "A2"
            
    wb.save(path)


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
        or name.startswith("1-20 Units ")
        or name.startswith("21+ Units ")
    )


def format_with_commas(val_str: str) -> str:
    """Add commas as thousands separators to a numeric string representation."""
    if not val_str:
        return ""
    cleaned = val_str.replace(",", "").strip()
    if not cleaned:
        return ""
    try:
        if "." in cleaned:
            parts = cleaned.split(".")
            integer_part = f"{int(parts[0]):,}"
            return f"{integer_part}.{parts[1]}"
        return f"{int(cleaned):,}"
    except ValueError:
        return val_str


# ---------------------------------------------------------------------------
# Message script counter — rotates scripts 1-8 for single listings
# Scripts 10, 11, and 12 are used when neither occupancy nor revenue data qualifies
# ---------------------------------------------------------------------------
_script_counter: int = 0
_fallback_counter: int = 0
_SINGLE_SCRIPTS = [1, 2, 3, 4, 5, 6, 7, 8]


def _next_script_index() -> int:
    global _script_counter
    idx = _script_counter % len(_SINGLE_SCRIPTS)
    _script_counter += 1
    return _SINGLE_SCRIPTS[idx]


def select_script_pair(row: dict[str, str], use_occupancy: bool, use_revenue: bool) -> tuple[int, int]:
    """Select two different script numbers for Message v1 and Message v2.

    Priority rules:
    - If gates closed (no high occupancy/revenue) and rating < 4.6: returns (11, 12)
    - If gates closed and rating >= 4.6: returns (10, 12) or (12, 10) alternating
    - If gates open (high value): returns two different scripts from 1-8 rotating
    """
    global _fallback_counter
    if not use_occupancy and not use_revenue:
        rating_val = parse_number(row.get("Overall Rating"))
        if rating_val is not None and rating_val < 4.6:
            return (11, 12)
        # Alternate ordering of (10, 12)
        if _fallback_counter % 2 == 0:
            pair = (10, 12)
        else:
            pair = (12, 10)
        _fallback_counter += 1
        return pair

    idx1 = _next_script_index()
    # Select next index wrapped within 1-8
    idx2 = idx1 + 1
    if idx2 > 8:
        idx2 = 1
    return (idx1, idx2)


def build_message_1(row: dict[str, str], script_num: int, combined: bool = False,
                    combined_gap: float = 0.0, listing_count: int = 0) -> str:
    """Build Message 1 for a row using the specified script number.

    Rules enforced here:
    - Occupancy-related text ({{occupancy}}, {{marketOccupancy}}) is only used
      when Occupancy Gap <= -9.3.
    - Revenue text ({{revenueGap}}) is only used when Revenue Potential Gap >= 190_000_000.
    - Portfolio (Script 9) is used when listing_count >= 2.
    """
    currency = row.get("currency", "IDR")
    beds_raw = row.get("Bedrooms", "").strip().rstrip(".0") or "?"

    occupancy_val = parse_number(row.get("Occupancy"))
    occupancy_gap_val = parse_number(row.get("Occupancy Gap"))
    market_occ_val = parse_number(row.get("Market Avg. Occupancy"))
    revenue_gap_val = parse_number(row.get("Revenue Potential Gap"))
    reviews_val = parse_number(row.get("Number of Reviews"))
    rating_val = parse_number(row.get("Overall Rating"))

    # Decide whether occupancy facts are eligible to be included
    use_occupancy = (occupancy_gap_val is not None and occupancy_gap_val <= -9.3)
    # Decide whether revenue gap is eligible
    use_revenue = (revenue_gap_val is not None and revenue_gap_val >= 190_000_000)

    occupancy_str = f"{occupancy_val:.1f}" if occupancy_val is not None else "??"
    market_occ_str = f"{market_occ_val:.1f}" if market_occ_val is not None else "??"
    revenue_gap_str = format_with_commas(format_number(revenue_gap_val, decimals=0)) if use_revenue else "[revenue data]"
    combined_gap_str = format_with_commas(format_number(combined_gap, decimals=0))
    reviews_str = str(int(reviews_val)) if reviews_val is not None else "??"
    rating_str = f"{rating_val:.1f}" if rating_val is not None else "??"

    # Script 9 and 13 — portfolios
    if combined or script_num in {9, 13}:
        use_combined_revenue = (combined_gap >= 190_000_000)
        if script_num == 13:
            if use_combined_revenue:
                return (
                    f"Hi! Quick question for the team managing your portfolio of {listing_count} properties -\n\n"
                    f"We ran some benchmark performance data for similar listings in Bali and spotted a combined "
                    f"{combined_gap_str} {currency} annual revenue gap.\n\n"
                    f"The idea isn't to replace your team's hard work, but to show you where the leak is and "
                    f"share how other operators are unlocking this hidden yield.\n\n"
                    f"Would you be open to seeing the listing breakdown?"
                )
            else:
                return (
                    f"Hi! Quick question for the team managing your portfolio of {listing_count} properties -\n\n"
                    f"We ran some benchmark performance data for similar listings in Bali to see how they compare to local lookalikes.\n\n"
                    f"The idea isn't to replace your team's hard work, but to share how other operators are "
                    f"optimizing performance and unlocking hidden yield.\n\n"
                    f"Would you be open to seeing the listing breakdown?"
                )
        else:
            if use_combined_revenue:
                return (
                    f"Hi there, We ran a local competitive benchmark across Bali listings and noticed a "
                    f"combined {combined_gap_str} {currency} revenue gap for {listing_count} of your properties "
                    f"that could be performing better.\n\n"
                    f"The idea isn't to replace your team's hard work, but to share where this gap is coming from "
                    f"and show you how other operators are unlocking this hidden yield.\n\n"
                    f"Let me know if you'd like to see the specific listing breakdown. Worth a quick 10-minute chat?"
                )
            else:
                return (
                    f"Hi there, We ran a local competitive benchmark across Bali listings for {listing_count} of your properties "
                    f"to see how they compare to local lookalike properties.\n\n"
                    f"The idea isn't to replace your team's hard work, but to share how other operators "
                    f"are optimizing performance and unlocking hidden yield.\n\n"
                    f"Let me know if you'd like to see the specific listing breakdown. Worth a quick 10-minute chat?"
                )

    bed = beds_raw

    if script_num == 1:
        if use_occupancy and use_revenue:
            details = (
                f" I was reviewing similar-sized listings and noticed yours is running at {occupancy_str}% occupancy, "
                f"while average properties of this scale are closer to {market_occ_str}%.\n"
                f"There's a potential {revenue_gap_str} {currency} in annual upside here."
            )
        elif use_occupancy:
            details = (
                f" I was reviewing similar-sized listings and noticed yours is running at {occupancy_str}% occupancy, "
                f"while average properties of this scale are closer to {market_occ_str}%."
            )
        elif use_revenue:
            details = f" I noticed there is a potential {revenue_gap_str} {currency} in annual revenue upside here."
        else:
            details = ""
        
        spacing = "\n" if details else " "
        return (
            f"Hi, is this the owner managing your {bed}-bedroom villa ?{details}{spacing}"
            f"We help managers find these hidden gaps. If I sent over a quick 2-minute video audit of this "
            f"property's specific performance gap, would you be open to taking a look?"
        )

    elif script_num == 2:
        rev_line = f"We spotted a {revenue_gap_str} {currency} annual revenue gap on the listing. " if use_revenue else ""
        return (
            f"Hi, quick question for the team behind your {bed}-bedroom property - \n\n"
            f"{rev_line}The idea isn't to replace what you're doing, but to show you where the leak is "
            f"and if similar upsides exist across the rest of your portfolio.\n\n"
            f"Would a quick 10-minute walkthrough of the data be useful?"
        )

    elif script_num == 3:
        occ_line = (
            f" Similar listings average {market_occ_str}% occupancy, while yours is at {occupancy_str}%."
        ) if use_occupancy else ""
        return (
            f"Hi, are you the owner managing your {bed}-bedroom property?\n\n"
            f"For a property of this scale, relying only on standard OTA bookings leaves a lot of money on the table.{occ_line}\n\n"
            f"We help large villas unlock high-value bookings outside standard channels (google ads, partnerships, "
            f"events, retreats, direct stays). \n\n"
            f"Happy to show you the key things that are holding it back - and what typically closes that gap if you are interested?"
        )

    elif script_num == 4:
        if use_revenue:
            rev_line = f" and noticed a potential {revenue_gap_str} {currency} annual upside on your property compared to lookalike {bed} bedroom listings."
        else:
            rev_line = "."
        return (
            f"Hi! Are you the owner or manager of the {bed}-bed villa?\n\n"
            f"I ran some performance data for listings of your scale{rev_line}\n\n"
            f"If I put together a quick 2-minute video showing where that gap is coming from, "
            f"would you be open to taking a look?"
        )

    elif script_num == 5:
        if use_occupancy and use_revenue:
            details = (
                f" I was analyzing local performance data and noticed your property is running at {occupancy_str}% occupancy, "
                f"while similar listings average {market_occ_str}%.\n"
                f"It looks like there's an annual revenue gap of about {revenue_gap_str} {currency} here."
            )
        elif use_occupancy:
            details = (
                f" I was analyzing local performance data and noticed your property is running at {occupancy_str}% occupancy, "
                f"while similar listings average {market_occ_str}%."
            )
        elif use_revenue:
            details = f" I noticed there is a potential annual revenue gap of about {revenue_gap_str} {currency} here."
        else:
            details = ""
            
        spacing = "\n" if details else " "
        return (
            f"Hi, is this the owner or manager of this {bed}-bedroom listing?{details}{spacing}"
            f"I have a quick performance audit for this listing - would you be open to seeing it?"
        )

    elif script_num == 6:
        if use_occupancy and use_revenue:
            body = (
                f"Interestingly, despite that great reputation, the data shows it's running at {occupancy_str}% occupancy, "
                f"while similar-tier properties are averaging closer to {market_occ_str}%.\n"
                f"That gap represents about {revenue_gap_str} {currency} in annual missed revenue."
            )
        elif use_occupancy:
            body = (
                f"Interestingly, despite that great reputation, the data shows it's running at {occupancy_str}% occupancy, "
                f"while similar-tier properties are averaging closer to {market_occ_str}%."
            )
        elif use_revenue:
            body = f"I noticed there is a potential annual revenue gap of about {revenue_gap_str} {currency} on this property compared to similar-tier listings."
        else:
            body = "I was looking at some local performance data for similar listings and would love to share a quick insight."
            
        return (
            f"Hi! Congrats on hitting {reviews_str} reviews with a {rating_str}★ rating on your "
            f"{bed}-bedroom listing - that's seriously impressive.\n\n"
            f"{body}\n\n"
            f"Would you be open to a quick 10-minute chat to see where that gap is coming from?"
        )

    elif script_num == 7:
        if use_occupancy and use_revenue:
            occ_line = (
                f" There is currently a potential {revenue_gap_str} {currency} gap between your current "
                f"occupancy ({occupancy_str}%) and similar premium properties ({market_occ_str}%)."
            )
        elif use_occupancy:
            occ_line = f" Your current occupancy ({occupancy_str}%) is currently running below the local average for premium properties ({market_occ_str}%)."
        elif use_revenue:
            occ_line = f" There is currently a potential annual revenue gap of about {revenue_gap_str} {currency} on this listing."
        else:
            occ_line = ""
            
        spacing = "\n\n" if occ_line else " "
        return (
            f"Hi, is the owner or manager of this {bed}-bedroom property? "
            f"For an elite property of this scale, relying purely on standard OTA bookings leaves a massive "
            f"amount of money on the table.{occ_line}{spacing}"
            f"We help luxury portfolios tap into event booking, direct stay, and retreat channels to capture "
            f"this exact upside. I have a quick performance audit for this listing - would you be open to seeing it?"
        )

    elif script_num == 8:
        if use_occupancy and use_revenue:
            body = (
                f"It looks like it is currently sitting at {occupancy_str}% occupancy, compared to the "
                f"local benchmark of {market_occ_str}% for listings of this scale - leaving roughly {revenue_gap_str} {currency} of annual upside on the table."
            )
        elif use_occupancy:
            body = f"It looks like it is currently sitting at {occupancy_str}% occupancy, compared to the local benchmark of {market_occ_str}% for listings of this scale."
        elif use_revenue:
            body = f"I noticed there is roughly {revenue_gap_str} {currency} of annual upside left on the table compared to lookalikes."
        else:
            body = "I was running some local performance benchmark comparisons for listings of this caliber."
            
        return (
            f"Hi! I was looking at the cover photo of your gorgeous {bed}-bedroom listing "
            f"(the one with the beautiful pool/view) and ran some quick occupancy numbers.\n\n"
            f"{body}\n\n"
            f"I have a quick performance audit for this listing - would you be open to seeing it?"
        )

    elif script_num == 10:
        # No occupancy or revenue data qualifies — use a general reputation-based hook
        return (
            f"Hi! Congrats on hitting {reviews_str} reviews with a {rating_str}\u2605 rating on your "
            f"{bed}-bedroom listing - that's seriously impressive.\n\n"
            f"Interestingly, despite that great reputation, the data shows there's a quite huge revenue gap "
            f"for your villa. Would you be interested in hearing how you compare to other lookalike properties?"
        )

    elif script_num == 11:
        # No occupancy or revenue data qualifies AND rating is below 4.6
        return (
            f"Hi! Are you the owner or manager of this {bed}-bedroom listing?\n\n"
            f"I was just checking out properties in your area and ran a performance comparison for {bed}BR "
            f"properties and there's a quite huge revenue gap for your villa. "
            f"Would you be interested in hearing how you compare to other lookalike properties?"
        )

    elif script_num == 12:
        # General benchmark fallback (low revenue, rating >= 4.6)
        bed_desc = f"your {bed}-bedroom property" if (bed and bed != "?") else "your property"
        return (
            f"Hi there,\n"
            f"We ran a local competitive benchmark across Bali listings for {bed_desc} "
            f"and noticed there’s a quite huge revenue gap for your villa.\n\n"
            f"The idea isn't to replace your team's hard work, but to share how other operators "
            f"are optimizing performance and unlocking hidden yield.\n\n"
            f"Would you be interested in hearing how you compare to other lookalike properties?"
        )

    return ""


def apply_k_formatting(rows: list[dict[str, str]]) -> None:
    """Format key financial metrics into thousands (k) format."""
    columns_to_format = [
        "Revenue Potential Gap",
        "Revenue",
        "Market avg. revenue",
        "Revenue Potential",
        "ADR",
        "Market avg. ADR"
    ]
    for row in rows:
        for col in columns_to_format:
            val = parse_number(row.get(col))
            if val is not None:
                # Format to thousands with k (e.g. 745,133k)
                k_val = int(round(val / 1000))
                row[col] = f"{k_val:,}k"


def build_wowem_msg(row: dict[str, str]) -> str:
    outreach_action = row.get("Outreach Action", "")
    if "🔴 DUPLICATE" in outreach_action:
        return ""

    days_avail = parse_number(row.get("Days Available"))
    rev = parse_number(row.get("Revenue"))
    m_rev = parse_number(row.get("Market avg. revenue"))
    occ = parse_number(row.get("Occupancy"))
    m_occ = parse_number(row.get("Market Avg. Occupancy"))
    adr = parse_number(row.get("ADR"))
    m_adr = parse_number(row.get("Market avg. ADR"))
    
    def is_valid(val: float | None) -> bool:
        return val is not None and val > 0
        
    def format_to_k(val: float | None) -> str:
        if val is None:
            return ""
        k_val = int(round(val / 1000))
        return f"{k_val:,}k"

    bullets = []
    
    if is_valid(days_avail):
        bullets.append(f"-{int(round(days_avail))} days available on Airbnb (I assume the remaining days are booked via other platforms)")
        
    if is_valid(rev) and is_valid(m_rev) and rev < m_rev:
        bullets.append(f"-IDR{format_to_k(rev)} annual revenue vs IDR{format_to_k(m_rev)} market avg. revenue")
        
    if is_valid(occ) and is_valid(m_occ) and occ < m_occ:
        occ_str = format_number(occ, decimals=1) if occ % 1 != 0 else str(int(occ))
        m_occ_str = format_number(m_occ, decimals=1) if m_occ % 1 != 0 else str(int(m_occ))
        bullets.append(f"-{occ_str}% occupancy vs {m_occ_str}% market avg. occupancy")
        
    if is_valid(adr) and is_valid(m_adr) and adr < m_adr:
        bullets.append(f"-IDR{format_to_k(adr)} average daily rate vs IDR{format_to_k(m_adr)} market avg. daily rate")
        
    if not bullets:
        return ""
        
    bullets_text = "\n".join(bullets)
    
    msg = (
        "I only have visibility into your Airbnb data, but here’s what it shows:\n"
        f"{bullets_text}\n\n"
        "This points to a pricing and positioning issue, not a lack of demand.\n\n"
        "I run “5-Step Booking Optimization System” for luxury 5BR+ villas.\n"
        "First step is completely free performance & competitor analysis showing where bookings are being missed.\n\n"
        "Want me to send it over?"
    )
    return msg


def tag_host_outreach_action(rows: list[dict[str, str]]) -> None:
    """Tag each row with Outreach Action, listingCount, outreachMessage and Message 1.

    Rules:
    - Rows where Property Manager/Host is blank are always tagged ⚪️ SEND SINGLE.
    - Hosts who appear exactly once: ⚪️ SEND SINGLE, listingCount = blank.
    - Hosts who appear 2+ times:
        * First occurrence : 🟢 SEND COMBINED (Portfolio of X), listingCount = X
        * All subsequent  : 🔴 DUPLICATE (Combined Above),       listingCount = blank
    """
    # Step 1: count how many times each host ID appears (ignore blanks) and sum their gaps
    host_counts: Counter[str] = Counter()
    host_total_gaps: dict[str, float] = defaultdict(float)

    for row in rows:
        host_id = row.get("Property Manager/Host", "").strip()
        if host_id:
            host_counts[host_id] += 1
            gap_val = parse_number(row.get("Revenue Potential Gap"))
            if gap_val is not None:
                host_total_gaps[host_id] += gap_val

    # Step 2: track which hosts we have already seen (to detect first vs subsequent)
    seen_hosts: set[str] = set()

    for row in rows:
        host_id = row.get("Property Manager/Host", "").strip()
        currency = row.get("currency", "IDR")

        # Prepare single listing message variables
        beds = row.get("Bedrooms", "").strip()
        if beds.endswith(".0"):
            beds = beds[:-2]

        single_gap_val = parse_number(row.get("Revenue Potential Gap"))
        single_gap_formatted = format_with_commas(format_number(single_gap_val, decimals=0)) if single_gap_val is not None else "0"

        count = host_counts.get(host_id, 0) if host_id else 0

        # ---- Assign Outreach Action & listingCount ----
        if not host_id or count == 1:
            row["Outreach Action"] = "⚪️ SEND SINGLE"
            row["listingCount"] = ""  # blank for singles and blanks
            bed_desc = f"your {beds}-bedroom property" if beds else "your property"
            
            # Assign rotating single-listing script pair
            # Compute eligibility flags here so select_script_pair can use them
            _occ_gap = parse_number(row.get("Occupancy Gap"))
            _rev_gap = parse_number(row.get("Revenue Potential Gap"))
            _use_occ = (_occ_gap is not None and _occ_gap <= -9.3)
            _use_rev = (_rev_gap is not None and _rev_gap >= 190_000_000)
            
            s1, s2 = select_script_pair(row, _use_occ, _use_rev)
            row["Message v1"] = build_message_1(row, s1)
            row["Message v2"] = build_message_1(row, s2)
            row["Wow'em msg"] = build_wowem_msg(row)

        elif host_id not in seen_hosts:
            # First time we see this multi-listing host — mark as primary
            row["Outreach Action"] = f"🟢 SEND COMBINED (Portfolio of {count})"
            row["listingCount"] = str(count)  # populate only for 2+ duplicates
            seen_hosts.add(host_id)

            combined_gap = host_total_gaps[host_id]

            # Script 9 (portfolio message v1) for Message v1
            row["Message v1"] = build_message_1(
                row, script_num=9, combined=True,
                combined_gap=combined_gap, listing_count=count
            )
            # Script 13 (portfolio message v2) for Message v2
            row["Message v2"] = build_message_1(
                row, script_num=13, combined=True,
                combined_gap=combined_gap, listing_count=count
            )
            row["Wow'em msg"] = build_wowem_msg(row)

        else:
            # Subsequent occurrence of a multi-listing host — mark as duplicate
            row["Outreach Action"] = "🔴 DUPLICATE (Combined Above)"
            row["listingCount"] = ""
            row["Message v1"] = ""
            row["Message v2"] = ""
            row["Wow'em msg"] = ""


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

    # Tag each row with the Traffic Light outreach action and listingCount
    # Must run AFTER sort so that rows for the same host are already adjacent
    tag_host_outreach_action(combined_units_1_to_20_rows)
    tag_host_outreach_action(combined_units_21_plus_rows)

    apply_k_formatting(combined_units_1_to_20_rows)
    apply_k_formatting(combined_units_21_plus_rows)

    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    units_1_to_20_state_label = format_state_label(
        count_states(combined_units_1_to_20_rows),
        combined_states,
    )
    units_21_plus_state_label = format_state_label(
        count_states(combined_units_21_plus_rows),
        combined_states,
    )
    units_1_to_20_output = args.output_dir / f"1-20 Units {timestamp}.csv"
    units_1_to_20_xlsx = args.output_dir / f"1-20 Units {timestamp}.xlsx"
    units_21_plus_output = args.output_dir / f"21+ Units {timestamp}.csv"
    units_21_plus_xlsx = args.output_dir / f"21+ Units {timestamp}.xlsx"
    
    write_csv(units_1_to_20_output, combined_headers, combined_units_1_to_20_rows)
    write_xlsx(units_1_to_20_xlsx, combined_headers, combined_units_1_to_20_rows)
    
    write_csv(units_21_plus_output, combined_headers, combined_units_21_plus_rows)
    write_xlsx(units_21_plus_xlsx, combined_headers, combined_units_21_plus_rows)

    for key, value in totals.items():
        print(f"{key}: {value}")
    print(f"units_1_to_20_output: {units_1_to_20_output}")
    print(f"units_1_to_20_xlsx: {units_1_to_20_xlsx}")
    print(f"units_21_plus_output: {units_21_plus_output}")
    print(f"units_21_plus_xlsx: {units_21_plus_xlsx}")

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
            step_name="Filter — python_airbnb_filter_01",
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
