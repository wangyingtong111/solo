import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

print("Starting dashboard...", flush=True)

try:
    from app import LogDashboard
    print("Import successful", flush=True)
    
    dashboard = LogDashboard()
    print("Dashboard instance created", flush=True)
    
    dashboard.start(host="0.0.0.0", port=8050)
except Exception as e:
    import traceback
    print(f"ERROR: {e}", flush=True)
    traceback.print_exc()
    sys.exit(1)
