import urllib.request
import json
import sys
import urllib.error

def get_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
    }

def main():
    token = "ntn_Fi8188139818XaWZGZLUHOC16ucishhrgK591MHrs3Sh0k"
    base_db_id = "367030ce-1c1d-8072-9f1d-dd0bda8dd10e"
    target_db_id = "36f030ce-1c1d-8056-b22d-c2500741a64d"
    
    headers = get_headers(token)
    
    # 1. Fetch Target Database to identify its existing title property
    print("Fetching target database 'Leads 1' schema...")
    target_url = f"https://api.notion.com/v1/databases/{target_db_id}"
    req_target = urllib.request.Request(target_url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req_target, timeout=15) as res:
            target_data = json.loads(res.read().decode('utf-8'))
            target_props = target_data.get("properties", {})
    except Exception as e:
        print(f"Error fetching target DB: {e}")
        return

    target_title_prop_name = None
    for name, prop in target_props.items():
        if prop.get("type") == "title":
            target_title_prop_name = name
            break
            
    print(f"Target DB title property name is currently: '{target_title_prop_name}'")

    # 2. Fetch Base Database schema
    print("Fetching base database 'AI SETTER' schema...")
    base_url = f"https://api.notion.com/v1/databases/{base_db_id}"
    req_base = urllib.request.Request(base_url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req_base, timeout=15) as res:
            base_data = json.loads(res.read().decode('utf-8'))
            base_props = base_data.get("properties", {})
    except Exception as e:
        print(f"Error fetching base DB: {e}")
        return

    print(f"Loaded {len(base_props)} properties from base database.")

    # Find the title property in the base database
    base_title_prop_name = None
    for name, prop in base_props.items():
        if prop.get("type") == "title":
            base_title_prop_name = name
            break
    print(f"Base DB title property name is: '{base_title_prop_name}'")

    # 3. Clean and prepare properties
    properties_to_patch = {}

    # Always rename the target DB's title property to "Title" so it matches the CSV column.
    # Do NOT copy the base DB's title name (e.g. 'leadID') — that would hijack the title slot.
    CANONICAL_TITLE_NAME = "Title"
    if target_title_prop_name and target_title_prop_name != CANONICAL_TITLE_NAME:
        print(f"Renaming target title property '{target_title_prop_name}' → '{CANONICAL_TITLE_NAME}'")
        properties_to_patch[target_title_prop_name] = {
            "name": CANONICAL_TITLE_NAME
        }

    for name, prop in base_props.items():
        prop_type = prop.get("type")
        
        # Title property is handled separately/skipped as it is built-in
        if prop_type == "title":
            continue
            
        # Skip read-only types that cannot be created/configured directly
        if prop_type in ["formula", "rollup", "created_time", "created_by", "last_edited_time", "last_edited_by"]:
            print(f"Skipping read-only property: '{name}' (Type: {prop_type})")
            continue
            
        # Clean type config
        type_config = prop.get(prop_type, {})
        cleaned_config = {}
        
        if prop_type == "select":
            # Strip IDs from options
            options = type_config.get("options", [])
            cleaned_options = []
            for opt in options:
                cleaned_opt = {"name": opt["name"]}
                if "color" in opt:
                    cleaned_opt["color"] = opt["color"]
                cleaned_options.append(cleaned_opt)
            cleaned_config = {"options": cleaned_options}
        elif prop_type == "multi_select":
            options = type_config.get("options", [])
            cleaned_options = []
            for opt in options:
                cleaned_opt = {"name": opt["name"]}
                if "color" in opt:
                    cleaned_opt["color"] = opt["color"]
                cleaned_options.append(cleaned_opt)
            cleaned_config = {"options": cleaned_options}
        elif prop_type == "number":
            # Carry over formatting if defined
            cleaned_config = {}
            if "format" in type_config:
                cleaned_config["format"] = type_config["format"]
        else:
            # For most other types (rich_text, url, email, date, checkbox, phone_number) we send empty dict
            cleaned_config = {}
            
        properties_to_patch[name] = {
            prop_type: cleaned_config
        }

    print(f"Prepared {len(properties_to_patch)} properties to create/update on target database.")

    # 4. Patch target database in batches of 5 properties to avoid timeouts or large payloads failing
    prop_items = list(properties_to_patch.items())
    batch_size = 5
    success_count = 0
    failure_count = 0
    
    for i in range(0, len(prop_items), batch_size):
        batch = prop_items[i:i+batch_size]
        batch_props = {name: val for name, val in batch}
        
        payload = {"properties": batch_props}
        print(f"Sending batch {i//batch_size + 1} ({len(batch)} properties: {', '.join(batch_props.keys())})...")
        
        req = urllib.request.Request(
            f"https://api.notion.com/v1/databases/{target_db_id}",
            data=json.dumps(payload).encode('utf-8'),
            headers=headers,
            method="PATCH"
        )
        
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                if res.status == 200:
                    print(f"Batch {i//batch_size + 1} successfully created!")
                    success_count += len(batch)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8')
            print(f"Batch {i//batch_size + 1} FAILED! Status: {e.code}. Error details: {err_body}")
            failure_count += len(batch)
            # Let's try individual patch if batch failed, to salvage what we can and see exactly which one fails
            print("Retrying properties in this batch individually...")
            for ind_name, ind_val in batch:
                ind_payload = {"properties": {ind_name: ind_val}}
                ind_req = urllib.request.Request(
                    f"https://api.notion.com/v1/databases/{target_db_id}",
                    data=json.dumps(ind_payload).encode('utf-8'),
                    headers=headers,
                    method="PATCH"
                )
                try:
                    with urllib.request.urlopen(ind_req, timeout=15) as ind_res:
                        if ind_res.status == 200:
                            print(f"  - Successfully created: '{ind_name}'")
                            success_count += 1
                            failure_count -= 1
                except urllib.error.HTTPError as ind_e:
                    ind_err = ind_e.read().decode('utf-8')
                    print(f"  - FAILED to create: '{ind_name}'. Error: {ind_err}")
                except Exception as ind_ex:
                    print(f"  - Error creating: '{ind_name}': {ind_ex}")
        except Exception as e:
            print(f"Batch {i//batch_size + 1} FAILED due to network/unexpected error: {e}")
            failure_count += len(batch)

    print(f"\nDone! Successfully cloned/updated {success_count} properties.")
    if failure_count > 0:
        print(f"Failed to clone {failure_count} properties.")

if __name__ == "__main__":
    main()
