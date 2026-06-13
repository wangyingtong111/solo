"""
NLP 历史查询功能快速测试 (v2 - 无 emoji, 直接输出)
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from datetime import datetime, timedelta
import config
from history_store import HistoryStore
from nlp_query import NLQueryEngine


def main():
    print("=" * 60)
    print("NLP History Query Test")
    print("=" * 60)

    db_path = os.path.join(config.STORAGE_DIR, "test_history.sqlite3")
    if os.path.exists(db_path):
        store = HistoryStore(db_path=db_path)
        store.start()
        need_fill = store.get_stats().get("api_minute_snapshots_rows", 0) < 100
    else:
        store = HistoryStore(db_path=db_path)
        store.start()
        need_fill = True

    if need_fill:
        print(f"\n[Backfill] {config.HISTORY_BACKFILL_HOURS}h history ...")
        store.seed_backfill_history(hours=config.HISTORY_BACKFILL_HOURS)

    print("\n[Stats]")
    stats = store.get_stats()
    for k, v in stats.items():
        print(f"  {k}: {v}")

    engine = NLQueryEngine()

    test_queries = [
        "昨天下午最慢的三个接口",
        "今天上午错误率最高的 5 个 API",
        "过去 1 小时调用最多的接口",
        "昨天调用最少的服务 top 10",
        "前天晚上 p99 最高的服务",
        "2 小时前最慢的 3 个 API",
        "今天凌晨调用最多的接口 top5",
        "昨天中午 12 点到下午 2 点错误率最高的接口",
    ]

    passed = 0
    for q in test_queries:
        print(f"\n{'-' * 50}")
        print(f"Query: {q}")
        parsed = engine.parse(q)

        tr = parsed.time_range
        if tr:
            print(f"  TimeRange: {tr['from']} ~ {tr['to']}")
        else:
            print(f"  TimeRange: (default)")

        print(f"  Entity: {parsed.entity_type}  Metric: {parsed.metric}  "
              f"Sort: {parsed.sort_by} {parsed.sort_order}  Limit: {parsed.limit}")

        result = engine.execute_with_history(parsed, store)

        tused = result.get("time_range_used", {})
        print(f"  Source: {tused.get('label', 'N/A')}")
        print(f"  Count: {len(result.get('results', []))}  Empty: {result.get('empty', False)}")

        rs = result.get("results", [])
        if rs:
            passed += 1
            print(f"  Results:")
            for i, r in enumerate(rs[:3]):
                val = r.get(parsed.sort_by, '?')
                name = r['name'][:55]
                print(f"    {i+1}. {name} -> {parsed.sort_by}={val}, reqs={r.get('total_requests', 0)}")
        else:
            print(f"  WARN: {result.get('description', 'no data')}")

    store.stop()

    print("\n" + "=" * 60)
    if passed == len(test_queries):
        print(f"PASS: All {passed} queries returned data")
    else:
        print(f"PARTIAL: {passed}/{len(test_queries)} queries returned data")
    print("=" * 60)


if __name__ == "__main__":
    main()
