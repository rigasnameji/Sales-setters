import urllib.request
import json
import sys

def main():
    token = "ntn_Fi8188139818XaWZGZLUHOC16ucishhrgK591MHrs3Sh0k"
    base_db_id = "367030ce-1c1d-8072-9f1d-dd0bda8dd10e"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28"
    }
    url = f"https://api.notion.com/v1/databases/{base_db_id}"
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            db_data = json.loads(res.read().decode('utf-8'))
            title = "".join([t.get("plain_text", "") for t in db_data.get("title", [])])
            print(f"Base DB Title: '{title}'")
            properties = db_data.get("properties", {})
            print(f"Number of properties: {len(properties)}")
            # Show a few properties as example
            keys = list(properties.keys())[:5]
            for key in keys:
                print(f"  - '{key}': {properties[key]}")
    except urllib.error.HTTPError as e:
        print(f"HTTP Error: {e.code} - {e.read().decode('utf-8')}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
