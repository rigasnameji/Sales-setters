import openpyxl
from openpyxl.worksheet.datavalidation import DataValidation
import zipfile
import xml.dom.minidom
from pathlib import Path

def main():
    # 1. Create a dummy workbook with Last Contact Date validation
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    
    headers = ["Last Contact Date"]
    ws.append(headers)
    
    # Add a date validation rule for DD-MM-YY formatting help
    # Note: openpyxl doesn't have a regex validator directly, so we use a custom formula
    # or just type='custom' to allow validation. To show a tooltip without blocking all text,
    # we can use showInputMessage=True.
    dv = DataValidation(
        type="custom",
        formula1="AND(ISNUMBER(A2), CELL(\"format\", A2)=\"D4\")", # example custom formula or any formula
        allow_blank=True,
        showInputMessage=True,
        showErrorMessage=True,
        promptTitle="Date Format Required",
        prompt="Please enter date in DD-MM-YY format (e.g. 03-06-26).",
        errorTitle="Invalid Date Format",
        error="Date must be entered in DD-MM-YY format."
    )
    
    ws.add_data_validation(dv)
    dv.add("A2:A100")
    
    xlsx_path = Path("/Users/kristapsjansons/Documents_Local/Clone - Antigravity/AI SALES/scratch/test_val.xlsx")
    wb.save(xlsx_path)
    
    # 2. Unzip and extract xl/worksheets/sheet1.xml
    xml_content = ""
    with zipfile.ZipFile(xlsx_path, 'r') as zip_ref:
        xml_content = zip_ref.read("xl/worksheets/sheet1.xml").decode("utf-8")
        
    # 3. Format/Pretty print XML
    dom = xml.dom.minidom.parseString(xml_content)
    pretty_xml = dom.toprettyxml(indent="  ")
    
    # Save the pretty XML to scratch
    xml_path = Path("/Users/kristapsjansons/Documents_Local/Clone - Antigravity/AI SALES/scratch/sheet1_datavalidation.xml")
    xml_path.write_text(pretty_xml, encoding="utf-8")
    
    print(f"Generated XML file at: {xml_path}")

if __name__ == "__main__":
    main()
