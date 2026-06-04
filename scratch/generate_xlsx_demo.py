import openpyxl
from openpyxl.worksheet.datavalidation import DataValidation
from pathlib import Path

def main():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Outreach Checklist"
    
    headers = [
        "Listing URL",
        "Outreach Action",
        "Outreach Status",
        "Last Contact Date",
        "Outreach Channel",
        "Outreach Notes"
    ]
    ws.append(headers)
    
    # Add dummy data
    rows = [
        ["https://www.airbnb.com/rooms/101", "⚪️ SEND SINGLE", "📥 NEW", "", "AirBnB", ""],
        ["https://www.airbnb.com/rooms/102", "🟢 SEND COMBINED", "📥 NEW", "", "AirBnB", ""],
        ["https://www.airbnb.com/rooms/103", "🔴 DUPLICATE", "", "", "", ""],
    ]
    for r in rows:
        ws.append(r)
        
    # Apply freeze panes and autofilter
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    
    # 1. Setup Dropdowns
    dv_action = DataValidation(type="list", formula1='"⚪️ SEND SINGLE,🟢 SEND COMBINED,🔴 DUPLICATE"', allow_blank=True)
    ws.add_data_validation(dv_action)
    dv_action.add("B2:B100")
    
    dv_status = DataValidation(type="list", formula1='"📥 NEW,⏳ IN PROGRESS,✅ CONTACTED,💬 REPLIED,📅 BOOKED,❌ REJECTED,🚫 INVALID"', allow_blank=True)
    ws.add_data_validation(dv_status)
    dv_status.add("C2:C100")
    
    dv_channel = DataValidation(type="list", formula1='"AirBnB,WhatsApp,Email,Instagram,Facebook,Call,SMS"', allow_blank=True)
    ws.add_data_validation(dv_channel)
    dv_channel.add("E2:E100")
    
    # 2. Setup Suggestion 3: Date Validation Hover Prompt and Error Dialog
    # We validate that the date matches a valid format, and show custom hover dialog
    dv_date = DataValidation(
        type="custom", 
        formula1="AND(ISNUMBER(D2), CELL(\"format\", D2)=\"D4\")", # custom Excel date formatting check formula
        allow_blank=True,
        showInputMessage=True,
        showErrorMessage=True,
        promptTitle="Date Format Instructions",
        prompt="Please enter date in DD-MM-YY format (e.g. 03-06-26).",
        errorTitle="Format Mismatch",
        error="Please enter the date using the DD-MM-YY structure."
    )
    ws.add_data_validation(dv_date)
    dv_date.add("D2:D100")
    
    # Column width adjustment
    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 20
    ws.column_dimensions["C"].width = 18
    ws.column_dimensions["D"].width = 24
    ws.column_dimensions["E"].width = 18
    ws.column_dimensions["F"].width = 25
    
    output_path = Path("/Users/kristapsjansons/Documents_Local/Clone - Antigravity/AI SALES/scratch/test_date_validation.xlsx")
    wb.save(output_path)
    print(f"Generated sample spreadsheet at: {output_path}")

if __name__ == "__main__":
    main()
