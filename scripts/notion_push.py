#!/usr/bin/env python3
"""
Push the final "Notion Ready" CSV to an existing Notion database.
Dynamically maps CSV columns to Notion database properties.

Usage:
  python3 scripts/notion_push.py \
    --csv "outputs/04_notion_ready/1-20 Units (Multiple States) 2026-05-28.csv" \
    --token "YOUR_NOTION_TOKEN" \
    --db "YOUR_NOTION_DATABASE_ID"
"""

import argparse
import csv
import json
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime

# Try to import audit log
try:
    sys.path.insert(0, str(Path(__file__).parent))
    from pipeline_audit import AuditLog
except ImportError:
    AuditLog = None


def get_notion_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
    }


def get_db_schema(token: str, db_id: str) -> dict:
    url = f"https://api.notion.com/v1/databases/{db_id}"
    req = urllib.request.Request(url, headers=get_notion_headers(token), method="GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            res = json.loads(response.read())
            return res.get("properties", {})
    except Exception as e:
        print(f"Error fetching DB schema: {e}")
        sys.exit(1)


def parse_number(val: str):
    try:
        cleaned = val.replace("$", "").replace(",", "").replace("%", "").strip()
        if not cleaned: return None
        return float(cleaned)
    except ValueError:
        return None


def format_property(prop_type: str, val: str):
    val = val.strip()
    if not val:
        return None

    if prop_type == "rich_text":
        return {"rich_text": [{"text": {"content": str(val)[:2000]}}]} # Max 2000 chars per text block
    elif prop_type == "title":
        return {"title": [{"text": {"content": str(val)[:2000]}}]}
    elif prop_type == "select":
        return {"select": {"name": str(val)}}
    elif prop_type == "url":
        # Notion requires a valid url structure
        if not val.startswith("http"):
            val = "https://" + val
        return {"url": val}
    elif prop_type == "email":
        return {"email": val}
    elif prop_type == "number":
        num = parse_number(val)
        return {"number": num} if num is not None else None
    elif prop_type == "date":
        # Attempt basic iso formatting if it looks like a date, else ignore
        try:
            return {"date": {"start": val}}
        except:
            return None
    return None


def push_to_notion(csv_path: Path, token: str, db_id: str) -> int:
    schema = get_db_schema(token, db_id)
    headers = get_notion_headers(token)
    url = "https://api.notion.com/v1/pages"
    
    # Find the title property name from schema
    title_prop_name = None
    for k, v in schema.items():
        if v.get("type") == "title":
            title_prop_name = k
            break
            
    if not title_prop_name:
        print("Error: Database does not have a Title property.")
        sys.exit(1)

    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    success_count = 0
    for i, row in enumerate(rows):
        properties = {}
        
        # Determine Title
        title_val = row.get("Title", "") or row.get("villaName", "") or row.get("Property Manager/Host", "") or f"Row {i}"
        properties[title_prop_name] = {"title": [{"text": {"content": title_val}}]}

        # Dynamically map all other columns matching schema
        for csv_col, val in row.items():
            if csv_col == title_prop_name or csv_col not in schema:
                continue
                
            prop_type = schema[csv_col].get("type")
            formatted = format_property(prop_type, str(val))
            if formatted is not None:
                properties[csv_col] = formatted

        data = {
            "parent": {"database_id": db_id},
            "properties": properties
        }

        req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"), headers=headers, method="POST")
        retries = 3
        delay = 1
        while retries > 0:
            try:
                with urllib.request.urlopen(req, timeout=15) as response:
                    if response.status == 200 or response.status == 201:
                        success_count += 1
                        break
            except urllib.error.HTTPError as e:
                err_body = e.read().decode("utf-8")
                if e.code == 429:
                    print(f"Rate limited on row {i+1}. Retrying in {delay}s...")
                    time.sleep(delay)
                    retries -= 1
                    delay *= 2
                else:
                    print(f"Failed to add row {i+1}. Status: {e.code}, Msg: {err_body}")
                    break
            except Exception as e:
                print(f"Error adding row {i+1}: {e}")
                break
        else:
            print(f"Failed to add row {i+1} after all retries due to rate limiting.")

        if (i + 1) % 20 == 0 or (i + 1) == len(rows):
            print(f"Progress: Pushed {i+1}/{len(rows)} rows successfully.")

    return success_count


def main():
    parser = argparse.ArgumentParser(description="Push CSV to Notion DB dynamically based on schema.")
    parser.add_argument("--csv", type=Path, required=True, help="Path to the Notion Ready CSV file")
    parser.add_argument("--token", type=str, required=True, help="Notion Integration Token")
    parser.add_argument("--db", type=str, required=True, help="Notion Database ID")
    args = parser.parse_args()

    if not args.csv.exists():
        print(f"File not found: {args.csv}")
        sys.exit(1)

    print(f"Pushing {args.csv.name} to Notion...")
    success_count = push_to_notion(args.csv, args.token, args.db)
    print(f"Successfully pushed {success_count} rows to Notion.")

    if AuditLog:
        import re
        base_stem = re.sub(r"\s*\d{4}-\d{2}-\d{2}$", "", args.csv.stem).strip()
        audit = AuditLog(base_stem)
        audit.append_step(
            step_number=5,
            step_name="Push to Notion — notion_push.py",
            details={
                "Input file": args.csv.name,
                "Target Database ID": args.db,
                "Rows pushed successfully": success_count
            }
        )

if __name__ == "__main__":
    main()
