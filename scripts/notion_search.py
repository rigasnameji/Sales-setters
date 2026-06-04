import urllib.request
import json
import sys

def main():
    token = "ntn_Fi8188139818XaWZGZLUHOC16ucishhrgK591MHrs3Sh0k"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28"
    }
    url = "https://api.notion.com/v1/search"
    data = {
        "query": "Leads 1",
        "filter": {
            "value": "database",
            "property": "object"
        }
    }
    req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            response_data = json.loads(res.read().decode('utf-8'))
            results = response_data.get("results", [])
            if not results:
                print("No databases found matching 'Leads 1'. Make sure the integration is shared with the database.")
                # Let's list all shared databases to help debug
                list_all_dbs(token)
                return
            for db in results:
                title = "".join([t.get("plain_text", "") for t in db.get("title", [])])
                print(f"Found Database: '{title}' | ID: {db.get('id')}")
    except urllib.error.HTTPError as e:
        print(f"HTTP Error: {e.code} - {e.read().decode('utf-8')}")
    except Exception as e:
        print(f"Error: {e}")

def list_all_dbs(token):
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28"
    }
    url = "https://api.notion.com/v1/search"
    data = {
        "filter": {
            "value": "database",
            "property": "object"
        }
    }
    req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            response_data = json.loads(res.read().decode('utf-8'))
            results = response_data.get("results", [])
            print("Shared databases:")
            for db in results:
                title = "".join([t.get("plain_text", "") for t in db.get("title", [])])
                print(f"- '{title}' | ID: {db.get('id')}")
    except Exception as e:
        print(f"Failed to list all databases: {e}")

if __name__ == "__main__":
    main()
