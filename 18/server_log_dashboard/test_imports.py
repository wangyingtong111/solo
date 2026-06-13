import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')

print("=== Checking imports ===")

modules = [
    ("dash", "dash"),
    ("plotly", "plotly"),
    ("pandas", "pandas"),
    ("numpy", "numpy"),
    ("scipy", "scipy"),
    ("config", "config"),
    ("kafka_consumer", "kafka_consumer"),
    ("aggregation", "aggregation"),
    ("anomaly_detector", "anomaly_detector"),
    ("forecaster", "forecaster"),
    ("dependency_graph", "dependency_graph"),
    ("nlp_query", "nlp_query"),
    ("report_generator", "report_generator"),
    ("websocket_handler", "websocket_handler"),
    ("dash_cytoscape", "dash-cytoscape"),
    ("flask_socketio", "flask-socketio"),
    ("pptx", "python-pptx"),
    ("jieba", "jieba"),
]

failed = []
passed = []
for mod_name, pkg_name in modules:
    try:
        __import__(mod_name)
        print(f"  [OK] {pkg_name}")
        passed.append(pkg_name)
    except Exception as e:
        print(f"  [FAIL] {pkg_name}: {e}")
        failed.append(pkg_name)

print(f"\n=== {len(passed)}/{len(modules)} modules OK ===")
if failed:
    print(f"Missing: {', '.join(failed)}")
else:
    print("All dependencies satisfied!")

print("\n=== Quick functionality test ===")

generated_logs = None
try:
    from kafka_consumer import LogGenerator
    gen = LogGenerator()
    logs = gen.generate_batch(1000)
    generated_logs = logs
    print(f"  [OK] Log generator: {len(logs)} logs generated")
except Exception as e:
    import traceback
    print(f"  [FAIL] Log generator: {e}")
    traceback.print_exc()

try:
    from aggregation import SlidingWindowAggregator
    agg = SlidingWindowAggregator(window_seconds=60)
    if generated_logs:
        agg.ingest(generated_logs)
        result = agg.aggregate()
        print(f"  [OK] Sliding window: {len(result['api_metrics'])} APIs, {len(result['service_metrics'])} services")
except Exception as e:
    import traceback
    print(f"  [FAIL] Sliding window: {e}")
    traceback.print_exc()

try:
    from anomaly_detector import AnomalyDetector
    det = AnomalyDetector()
    if generated_logs:
        agg_data = agg.aggregate()
        events = det.update_and_detect(
            agg_data.get("api_metrics", {}),
            agg_data.get("service_metrics", {}),
        )
        print(f"  [OK] Anomaly detector: {len(events)} events detected")
except Exception as e:
    import traceback
    print(f"  [FAIL] Anomaly detector: {e}")
    traceback.print_exc()

try:
    from dependency_graph import DependencyGraph
    dg = DependencyGraph()
    if generated_logs:
        dg.ingest(generated_logs)
        graph = dg.get_cytoscape_graph()
        print(f"  [OK] Dependency graph: {len(graph['nodes'])} nodes, {len(graph['edges'])} edges")
except Exception as e:
    import traceback
    print(f"  [FAIL] Dependency graph: {e}")
    traceback.print_exc()

try:
    from nlp_query import NLQueryEngine
    nlp = NLQueryEngine()
    parsed = nlp.parse("最慢的三个接口")
    print(f"  [OK] NLP engine: intent={parsed.intent}, entity={parsed.entity_type}, metric={parsed.metric}")
except Exception as e:
    import traceback
    print(f"  [FAIL] NLP engine: {e}")
    traceback.print_exc()

try:
    from forecaster import ProphetForecaster
    fc = ProphetForecaster()
    print(f"  [OK] Forecaster: initialized")
except Exception as e:
    import traceback
    print(f"  [FAIL] Forecaster: {e}")

try:
    from report_generator import ReportGenerator
    rg = ReportGenerator()
    print(f"  [OK] Report generator: initialized")
except Exception as e:
    import traceback
    print(f"  [FAIL] Report generator: {e}")
    traceback.print_exc()

try:
    from websocket_handler import WebSocketManager
    wm = WebSocketManager()
    print(f"  [OK] WebSocket manager: initialized")
except Exception as e:
    import traceback
    print(f"  [FAIL] WebSocket manager: {e}")
    traceback.print_exc()

print("\n=== All tests completed ===")
