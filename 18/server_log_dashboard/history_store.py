"""
历史数据持久化存储

负责将实时聚合的每分钟快照持久化到 SQLite（可切换 ClickHouse/Parquet），
保存最近 7 天的历史数据，用于：
  - NLP 自然语言查询（如"昨天下午最慢的三个接口"）
  - 历史趋势回溯
  - 长周期对比分析

设计要点：
  1. 轻量级：SQLite（无需额外服务，文件存储）
  2. 性能：批量写入（每分钟一次），异步线程
  3. 清理策略：滚动窗口，自动清理超过 7 天的数据
  4. 查询接口：按时间范围 + 维度（API/服务/状态码等）灵活查询
  5. 可切换：通过 config.USE_CLICKHOUSE 切换到 ClickHouse
"""

import os
import sqlite3
import threading
import time
import json
import queue
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from collections import defaultdict

import pandas as pd
import numpy as np

import config


class HistoryStore:
    """
    历史数据持久化存储（默认 SQLite 实现）

    表结构：
    ------
    api_minute_snapshots    - 每个 API 每分钟的聚合快照（核心表）
    service_minute_snapshots - 每个服务每分钟的聚合快照
    system_minute_snapshots  - 系统级每分钟的聚合快照
    """

    DB_PATH = os.path.join(config.STORAGE_DIR, "history.sqlite3")

    _instance = None
    _instance_lock = threading.Lock()

    @classmethod
    def get_instance(cls):
        """单例模式"""
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or self.DB_PATH
        self._lock = threading.RLock()
        self._write_queue: "queue.Queue" = queue.Queue(maxsize=10000)
        self._running = False
        self._write_thread = None
        self._init_db()

    # ----------------------------- DB 初始化 -----------------------------

    def _init_db(self):
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        with self._lock, sqlite3.connect(self.db_path) as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA cache_size=-64000")

            conn.executescript("""
                CREATE TABLE IF NOT EXISTS api_minute_snapshots (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp       TEXT    NOT NULL,
                    minute_bucket   TEXT    NOT NULL,
                    service         TEXT    NOT NULL,
                    endpoint        TEXT    NOT NULL,
                    method          TEXT    DEFAULT 'GET',
                    request_count   INTEGER DEFAULT 0,
                    error_count     INTEGER DEFAULT 0,
                    error_rate      REAL    DEFAULT 0.0,
                    avg_latency_ms  REAL    DEFAULT 0.0,
                    p50_latency_ms  REAL    DEFAULT 0.0,
                    p90_latency_ms  REAL    DEFAULT 0.0,
                    p95_latency_ms  REAL    DEFAULT 0.0,
                    p99_latency_ms  REAL    DEFAULT 0.0,
                    min_latency_ms  REAL    DEFAULT 0.0,
                    max_latency_ms  REAL    DEFAULT 0.0,
                    total_latency_sum REAL  DEFAULT 0.0,
                    status_2xx      INTEGER DEFAULT 0,
                    status_3xx      INTEGER DEFAULT 0,
                    status_4xx      INTEGER DEFAULT 0,
                    status_5xx      INTEGER DEFAULT 0,
                    created_at      TEXT    DEFAULT (datetime('now','localtime'))
                );

                CREATE INDEX IF NOT EXISTS idx_api_ts ON api_minute_snapshots(timestamp);
                CREATE INDEX IF NOT EXISTS idx_api_bucket ON api_minute_snapshots(minute_bucket);
                CREATE INDEX IF NOT EXISTS idx_api_service ON api_minute_snapshots(service);
                CREATE INDEX IF NOT EXISTS idx_api_endpoint ON api_minute_snapshots(endpoint);
                CREATE INDEX IF NOT EXISTS idx_api_composite
                    ON api_minute_snapshots(minute_bucket, service, endpoint);

                CREATE TABLE IF NOT EXISTS service_minute_snapshots (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp       TEXT    NOT NULL,
                    minute_bucket   TEXT    NOT NULL,
                    service         TEXT    NOT NULL,
                    request_count   INTEGER DEFAULT 0,
                    error_count     INTEGER DEFAULT 0,
                    error_rate      REAL    DEFAULT 0.0,
                    avg_latency_ms  REAL    DEFAULT 0.0,
                    p50_latency_ms  REAL    DEFAULT 0.0,
                    p95_latency_ms  REAL    DEFAULT 0.0,
                    p99_latency_ms  REAL    DEFAULT 0.0,
                    status_5xx      INTEGER DEFAULT 0,
                    created_at      TEXT    DEFAULT (datetime('now','localtime'))
                );

                CREATE INDEX IF NOT EXISTS idx_svc_ts ON service_minute_snapshots(timestamp);
                CREATE INDEX IF NOT EXISTS idx_svc_bucket ON service_minute_snapshots(minute_bucket);
                CREATE INDEX IF NOT EXISTS idx_svc_service ON service_minute_snapshots(service);

                CREATE TABLE IF NOT EXISTS system_minute_snapshots (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp       TEXT    NOT NULL,
                    minute_bucket   TEXT    NOT NULL,
                    total_requests  INTEGER DEFAULT 0,
                    total_errors    INTEGER DEFAULT 0,
                    error_rate      REAL    DEFAULT 0.0,
                    avg_latency_ms  REAL    DEFAULT 0.0,
                    p50_latency_ms  REAL    DEFAULT 0.0,
                    p95_latency_ms  REAL    DEFAULT 0.0,
                    p99_latency_ms  REAL    DEFAULT 0.0,
                    total_services  INTEGER DEFAULT 0,
                    total_endpoints INTEGER DEFAULT 0,
                    created_at      TEXT    DEFAULT (datetime('now','localtime'))
                );

                CREATE INDEX IF NOT EXISTS idx_sys_bucket ON system_minute_snapshots(minute_bucket);

                CREATE TABLE IF NOT EXISTS metadata (
                    key   TEXT PRIMARY KEY,
                    value TEXT
                );
            """)

            conn.commit()
            self._write_metadata(conn, "schema_version", "1.0")
            self._write_metadata(conn, "created_at", datetime.now().isoformat())

        print(f"[INFO] HistoryStore initialized at {self.db_path}")

    # ----------------------------- 元数据 -----------------------------

    def _write_metadata(self, conn, key: str, value: str):
        conn.execute(
            "INSERT OR REPLACE INTO metadata(key, value) VALUES(?, ?)",
            (key, value),
        )

    def get_metadata(self, key: str) -> Optional[str]:
        try:
            with self._lock, sqlite3.connect(self.db_path) as conn:
                cur = conn.execute(
                    "SELECT value FROM metadata WHERE key = ?", (key,)
                )
                row = cur.fetchone()
                return row[0] if row else None
        except Exception:
            return None

    # ----------------------------- 写入接口 -----------------------------

    def start(self):
        """启动异步写入线程"""
        if self._running:
            return
        self._running = True
        self._write_thread = threading.Thread(
            target=self._write_worker, daemon=True, name="HistoryStoreWriter"
        )
        self._write_thread.start()
        self._cleanup_thread = threading.Thread(
            target=self._cleanup_worker, daemon=True, name="HistoryStoreCleanup"
        )
        self._cleanup_thread.start()
        print(f"[INFO] HistoryStore started (retention={config.HISTORY_RETENTION_DAYS} days)")

    def stop(self):
        self._running = False
        if self._write_thread:
            self._write_thread.join(timeout=5)

    def write_snapshot(self,
                       timestamp: str,
                       api_metrics: Dict,
                       service_metrics: Dict,
                       system_metrics: Optional[Dict] = None):
        """
        接收聚合器的快照，推入写入队列

        Args:
            timestamp: ISO 格式时间戳
            api_metrics: { (service, endpoint): {...} } 来自 Aggregator
            service_metrics: { service: {...} }
            system_metrics: 系统级统计（可选）
        """
        try:
            minute_bucket = datetime.fromisoformat(timestamp).strftime("%Y-%m-%d %H:%M:00")
        except Exception:
            minute_bucket = timestamp[:16] + ":00"

        self._write_queue.put({
            "type": "snapshot",
            "timestamp": timestamp,
            "minute_bucket": minute_bucket,
            "api_metrics": self._serialize(api_metrics),
            "service_metrics": self._serialize(service_metrics),
            "system_metrics": system_metrics or {},
        })

    def _serialize(self, obj):
        """把 numpy 类型转为 Python 原生类型（防止 SQL 参数化出错）"""
        if isinstance(obj, dict):
            return {k: self._serialize(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [self._serialize(x) for x in obj]
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return obj

    # ----------------------------- 写入线程 -----------------------------

    def _write_worker(self):
        """后台线程：批量写入快照"""
        print("[INFO] HistoryStore write worker started")
        batch = []
        last_flush = time.time()
        BATCH_SIZE = 200
        FLUSH_INTERVAL = 5

        while self._running:
            try:
                try:
                    item = self._write_queue.get(timeout=1)
                    batch.append(item)
                except queue.Empty:
                    item = None

                now = time.time()
                flush_cond = (
                    len(batch) >= BATCH_SIZE
                    or (now - last_flush >= FLUSH_INTERVAL and len(batch) > 0)
                    or (item is None and len(batch) > 0 and now - last_flush >= 1)
                )

                if flush_cond:
                    self._flush_batch(batch)
                    batch = []
                    last_flush = now

            except Exception as e:
                print(f"[ERROR] HistoryStore write worker: {e}")
                time.sleep(1)

        if batch:
            self._flush_batch(batch)
        print("[INFO] HistoryStore write worker stopped")

    def _flush_batch(self, batch: List[Dict]):
        """批量写入一组快照"""
        api_rows = []
        svc_rows = []
        sys_rows = []

        for item in batch:
            if item["type"] != "snapshot":
                continue
            ts = item["timestamp"]
            mb = item["minute_bucket"]

            for (service, endpoint), m in item["api_metrics"].items():
                api_rows.append((
                    ts, mb, service, endpoint, m.get("method", "GET"),
                    m.get("request_count", 0), m.get("error_count", 0),
                    m.get("error_rate", 0.0),
                    m.get("avg_latency_ms", 0.0),
                    m.get("p50_latency_ms", 0.0),
                    m.get("p90_latency_ms", 0.0),
                    m.get("p95_latency_ms", 0.0),
                    m.get("p99_latency_ms", 0.0),
                    m.get("min_latency_ms", 0.0),
                    m.get("max_latency_ms", 0.0),
                    m.get("total_latency_sum", 0.0),
                    m.get("status_2xx", 0), m.get("status_3xx", 0),
                    m.get("status_4xx", 0), m.get("status_5xx", 0),
                ))

            for service, m in item["service_metrics"].items():
                svc_rows.append((
                    ts, mb, service,
                    m.get("request_count", 0), m.get("error_count", 0),
                    m.get("error_rate", 0.0),
                    m.get("avg_latency_ms", 0.0),
                    m.get("p50_latency_ms", 0.0),
                    m.get("p95_latency_ms", 0.0),
                    m.get("p99_latency_ms", 0.0),
                    m.get("status_5xx", 0),
                ))

            sm = item["system_metrics"]
            if sm:
                sys_rows.append((
                    ts, mb,
                    sm.get("total_requests", 0),
                    sm.get("total_errors", 0),
                    sm.get("error_rate", 0.0),
                    sm.get("avg_latency_ms", 0.0),
                    sm.get("p50_latency_ms", 0.0),
                    sm.get("p95_latency_ms", 0.0),
                    sm.get("p99_latency_ms", 0.0),
                    sm.get("total_services", 0),
                    sm.get("total_endpoints", 0),
                ))

        with self._lock, sqlite3.connect(self.db_path) as conn:
            try:
                if api_rows:
                    conn.executemany(
                        """INSERT INTO api_minute_snapshots(
                               timestamp, minute_bucket, service, endpoint, method,
                               request_count, error_count, error_rate,
                               avg_latency_ms, p50_latency_ms, p90_latency_ms,
                               p95_latency_ms, p99_latency_ms, min_latency_ms,
                               max_latency_ms, total_latency_sum,
                               status_2xx, status_3xx, status_4xx, status_5xx)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        api_rows,
                    )
                if svc_rows:
                    conn.executemany(
                        """INSERT INTO service_minute_snapshots(
                               timestamp, minute_bucket, service,
                               request_count, error_count, error_rate,
                               avg_latency_ms, p50_latency_ms,
                               p95_latency_ms, p99_latency_ms, status_5xx)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                        svc_rows,
                    )
                if sys_rows:
                    conn.executemany(
                        """INSERT INTO system_minute_snapshots(
                               timestamp, minute_bucket, total_requests,
                               total_errors, error_rate, avg_latency_ms,
                               p50_latency_ms, p95_latency_ms, p99_latency_ms,
                               total_services, total_endpoints)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                        sys_rows,
                    )
                conn.commit()
            except Exception as e:
                print(f"[ERROR] HistoryStore flush failed: {e}")
                conn.rollback()

    # ----------------------------- 清理线程 -----------------------------

    def _cleanup_worker(self):
        """后台线程：每小时清理过期数据"""
        while self._running:
            try:
                cutoff = (
                    datetime.now()
                    - timedelta(days=config.HISTORY_RETENTION_DAYS)
                ).isoformat()

                with self._lock, sqlite3.connect(self.db_path) as conn:
                    tables = [
                        "api_minute_snapshots",
                        "service_minute_snapshots",
                        "system_minute_snapshots",
                    ]
                    deleted_total = 0
                    for t in tables:
                        cur = conn.execute(
                            f"DELETE FROM {t} WHERE timestamp < ?",
                            (cutoff,),
                        )
                        deleted_total += cur.rowcount
                    conn.commit()

                    if deleted_total > 0:
                        print(
                            f"[INFO] HistoryStore cleaned {deleted_total:,} rows "
                            f"(older than {config.HISTORY_RETENTION_DAYS} days)"
                        )

                for _ in range(3600):
                    if not self._running:
                        break
                    time.sleep(1)

            except Exception as e:
                print(f"[ERROR] HistoryStore cleanup: {e}")
                time.sleep(300)

    # ----------------------------- 查询接口 -----------------------------

    def query_api_stats(self,
                        start_time: str,
                        end_time: str,
                        group_by: str = "endpoint",
                        limit: int = 20,
                        order_by: str = "p99_latency_ms",
                        order_desc: bool = True,
                        services: Optional[List[str]] = None,
                        endpoints: Optional[List[str]] = None,
                        min_requests: int = 10,
                        as_dataframe: bool = True):
        """
        按时间范围查询 API 维度的聚合统计

        Args:
            start_time: ISO 格式开始时间
            end_time: ISO 格式结束时间
            group_by: 'endpoint' | 'service' | 'service_endpoint'
            limit: 结果条数
            order_by: 排序字段（request_count/error_rate/p50_*/p99_*...）
            order_desc: 是否降序
            services: 指定服务过滤
            endpoints: 指定端点过滤
            min_requests: 总请求数下限（防止样本太少干扰排名）
            as_dataframe: True 返回 DataFrame，False 返回 list[dict]

        Returns:
            pd.DataFrame 或 list[dict]，包含在时间范围内聚合后的 API 统计
        """
        if group_by == "service_endpoint":
            select_cols = "service, endpoint"
            group_cols = "service, endpoint"
        elif group_by == "service":
            select_cols = "service, MIN(endpoint) as endpoint"
            group_cols = "service"
        else:
            select_cols = "MIN(service) as service, endpoint"
            group_cols = "endpoint"

        sql = f"""
            SELECT
                {select_cols},
                SUM(request_count)    as request_count,
                SUM(error_count)      as error_count,
                CASE WHEN SUM(request_count) > 0
                     THEN SUM(error_count) * 100.0 / SUM(request_count)
                     ELSE 0 END        as error_rate_pct,
                SUM(total_latency_sum) / MAX(SUM(request_count), 1) as avg_latency_ms,
                CAST(AVG(p50_latency_ms) AS REAL) as p50_latency_ms,
                CAST(AVG(p90_latency_ms) AS REAL) as p90_latency_ms,
                CAST(AVG(p95_latency_ms) AS REAL) as p95_latency_ms,
                CAST(MAX(p99_latency_ms) AS REAL) as p99_latency_ms,
                CAST(MAX(max_latency_ms) AS REAL) as max_latency_ms,
                CAST(MIN(min_latency_ms) AS REAL) as min_latency_ms,
                SUM(status_2xx) as status_2xx,
                SUM(status_3xx) as status_3xx,
                SUM(status_4xx) as status_4xx,
                SUM(status_5xx) as status_5xx,
                COUNT(DISTINCT minute_bucket) as sample_minutes
            FROM api_minute_snapshots
            WHERE timestamp >= ? AND timestamp <= ?
        """
        params = [start_time, end_time]

        if services:
            placeholders = ",".join("?" * len(services))
            sql += f" AND service IN ({placeholders})"
            params.extend(services)

        if endpoints:
            placeholders = ",".join("?" * len(endpoints))
            sql += f" AND endpoint IN ({placeholders})"
            params.extend(endpoints)

        sql += f" GROUP BY {group_cols}"
        sql += f" HAVING SUM(request_count) >= ?"
        params.append(min_requests)

        direction = "DESC" if order_desc else "ASC"
        sql += f" ORDER BY {order_by} {direction} LIMIT ?"
        params.append(limit)

        with self._lock, sqlite3.connect(self.db_path) as conn:
            if as_dataframe:
                conn.row_factory = sqlite3.Row
                cur = conn.execute(sql, params)
                rows = [dict(r) for r in cur.fetchall()]
                return pd.DataFrame(rows) if rows else pd.DataFrame()
            else:
                conn.row_factory = sqlite3.Row
                cur = conn.execute(sql, params)
                return [dict(r) for r in cur.fetchall()]

    def query_timeseries(self,
                         start_time: str,
                         end_time: str,
                         granularity: str = "minute",
                         services: Optional[List[str]] = None,
                         endpoints: Optional[List[str]] = None,
                         as_dataframe: bool = True):
        """
        按时间粒度查询时序数据（用于绘制趋势图）

        Args:
            granularity: 'minute' | '5min' | '15min' | 'hour'
            其余参数同 query_api_stats

        Returns:
            按时间聚合的时序 DataFrame
        """
        if granularity == "minute":
            bucket_expr = "minute_bucket"
        elif granularity == "5min":
            bucket_expr = "strftime('%Y-%m-%d %H:', timestamp) || printf('%02d:00', (CAST(strftime('%M', timestamp) AS INTEGER) / 5) * 5)"
        elif granularity == "15min":
            bucket_expr = "strftime('%Y-%m-%d %H:', timestamp) || printf('%02d:00', (CAST(strftime('%M', timestamp) AS INTEGER) / 15) * 15)"
        elif granularity == "hour":
            bucket_expr = "strftime('%Y-%m-%d %H:00:00', timestamp)"
        else:
            bucket_expr = "minute_bucket"

        sql = f"""
            SELECT
                {bucket_expr} as time_bucket,
                SUM(request_count)    as request_count,
                SUM(error_count)      as error_count,
                CASE WHEN SUM(request_count) > 0
                     THEN SUM(error_count) * 100.0 / SUM(request_count)
                     ELSE 0 END         as error_rate_pct,
                CAST(AVG(p50_latency_ms) AS REAL) as p50_latency_ms,
                CAST(AVG(p95_latency_ms) AS REAL) as p95_latency_ms,
                CAST(AVG(p99_latency_ms) AS REAL) as p99_latency_ms,
                SUM(status_5xx)       as status_5xx
            FROM api_minute_snapshots
            WHERE timestamp >= ? AND timestamp <= ?
        """
        params = [start_time, end_time]

        if services:
            placeholders = ",".join("?" * len(services))
            sql += f" AND service IN ({placeholders})"
            params.extend(services)

        if endpoints:
            placeholders = ",".join("?" * len(endpoints))
            sql += f" AND endpoint IN ({placeholders})"
            params.extend(endpoints)

        sql += f" GROUP BY time_bucket ORDER BY time_bucket"

        with self._lock, sqlite3.connect(self.db_path) as conn:
            if as_dataframe:
                conn.row_factory = sqlite3.Row
                cur = conn.execute(sql, params)
                rows = [dict(r) for r in cur.fetchall()]
                return pd.DataFrame(rows) if rows else pd.DataFrame()
            else:
                conn.row_factory = sqlite3.Row
                cur = conn.execute(sql, params)
                return [dict(r) for r in cur.fetchall()]

    def get_stats(self) -> Dict:
        """获取存储统计信息"""
        stats = {}
        try:
            with self._lock, sqlite3.connect(self.db_path) as conn:
                for table in [
                    "api_minute_snapshots",
                    "service_minute_snapshots",
                    "system_minute_snapshots",
                ]:
                    cur = conn.execute(f"SELECT COUNT(*) FROM {table}")
                    stats[f"{table}_rows"] = cur.fetchone()[0]

                cur = conn.execute(
                    "SELECT MIN(timestamp), MAX(timestamp) FROM api_minute_snapshots"
                )
                row = cur.fetchone()
                stats["time_range_start"] = row[0] or "N/A"
                stats["time_range_end"] = row[1] or "N/A"

                size_bytes = os.path.getsize(self.db_path) if os.path.exists(self.db_path) else 0
                stats["db_size_mb"] = round(size_bytes / 1024 / 1024, 2)

                stats["queue_depth"] = self._write_queue.qsize()

        except Exception as e:
            stats["error"] = str(e)

        return stats

    # ----------------------------- 启动时回填模拟历史数据 -----------------------------

    def seed_backfill_history(self, hours: int = 25):
        """
        启动时自动回填 `hours` 小时的模拟历史数据
        这样用户查询"昨天下午"才有数据可展示
        """
        print(f"[INFO] HistoryStore: backfilling {hours}h of simulated history...")
        now = datetime.now()
        start = now - timedelta(hours=hours)

        services = config.SERVICES
        endpoints = config.API_ENDPOINTS
        methods = ["GET", "POST", "PUT", "DELETE"]
        rng = np.random.default_rng(42)

        api_rows = []
        svc_rows = []
        sys_rows = []

        current = start
        minute_idx = 0
        while current <= now:
            ts = current.isoformat()
            mb = current.strftime("%Y-%m-%d %H:%M:00")

            hour_factor = 0.3 + 0.7 * max(
                np.sin(np.pi * ((current.hour - 6) / 12.0)), 0.1
            ) if current.hour >= 6 and current.hour <= 20 else 0.25
            error_chance = 0.02 + 0.03 * hour_factor

            sys_total_req = 0
            sys_total_err = 0
            sys_latencies = []

            for service in services:
                svc_req = 0
                svc_err = 0
                svc_latencies = []
                svc_5xx = 0

                for endpoint in endpoints:
                    base_volume = rng.integers(20, 200)
                    volume = int(base_volume * hour_factor * (
                        1.0 + 0.3 * rng.random()
                    ))
                    base_latency = 30 + 60 * rng.random()

                    latencies = []
                    err_count = 0
                    s2xx = s3xx = s4xx = s5xx = 0

                    for _ in range(volume):
                        latency = base_latency * (0.5 + rng.random() * 1.5)
                        if endpoint.endswith(("/checkout", "/login", "/payment")):
                            latency *= (1.2 + 0.5 * rng.random())
                        latencies.append(latency)
                        r = rng.random()
                        if r < error_chance:
                            err_count += 1
                            if r < error_chance * 0.4:
                                s5xx += 1
                            else:
                                s4xx += 1
                        elif r < error_chance + 0.05:
                            s3xx += 1
                        else:
                            s2xx += 1

                    latencies_arr = np.array(latencies) if latencies else np.array([base_latency])
                    req_count = volume
                    err = err_count
                    avg_lat = float(np.mean(latencies_arr))
                    p50 = float(np.percentile(latencies_arr, 50))
                    p90 = float(np.percentile(latencies_arr, 90))
                    p95 = float(np.percentile(latencies_arr, 95))
                    p99 = float(np.percentile(latencies_arr, 99))
                    min_l = float(np.min(latencies_arr))
                    max_l = float(np.max(latencies_arr))
                    err_rate = (err / req_count * 100) if req_count else 0.0

                    api_rows.append((
                        ts, mb, service, endpoint,
                        rng.choice(methods, p=[0.6, 0.25, 0.1, 0.05]),
                        req_count, err, err_rate, avg_lat,
                        p50, p90, p95, p99, min_l, max_l,
                        float(np.sum(latencies_arr)),
                        s2xx, s3xx, s4xx, s5xx,
                    ))

                    svc_req += req_count
                    svc_err += err
                    svc_latencies.extend(latencies)
                    svc_5xx += s5xx
                    sys_total_req += req_count
                    sys_total_err += err
                    sys_latencies.extend(latencies)

                svc_lat = np.array(svc_latencies) if svc_latencies else np.array([50])
                svc_rows.append((
                    ts, mb, service,
                    svc_req, svc_err,
                    (svc_err / svc_req * 100) if svc_req else 0,
                    float(np.mean(svc_lat)),
                    float(np.percentile(svc_lat, 50)),
                    float(np.percentile(svc_lat, 95)),
                    float(np.percentile(svc_lat, 99)),
                    svc_5xx,
                ))

            sys_lat = np.array(sys_latencies) if sys_latencies else np.array([50])
            sys_rows.append((
                ts, mb,
                sys_total_req, sys_total_err,
                (sys_total_err / sys_total_req * 100) if sys_total_req else 0,
                float(np.mean(sys_lat)),
                float(np.percentile(sys_lat, 50)),
                float(np.percentile(sys_lat, 95)),
                float(np.percentile(sys_lat, 99)),
                len(services),
                len(endpoints),
            ))

            current += timedelta(minutes=1)
            minute_idx += 1

        with self._lock, sqlite3.connect(self.db_path) as conn:
            conn.executemany(
                """INSERT INTO api_minute_snapshots(
                       timestamp, minute_bucket, service, endpoint, method,
                       request_count, error_count, error_rate,
                       avg_latency_ms, p50_latency_ms, p90_latency_ms,
                       p95_latency_ms, p99_latency_ms, min_latency_ms,
                       max_latency_ms, total_latency_sum,
                       status_2xx, status_3xx, status_4xx, status_5xx)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                api_rows,
            )
            conn.executemany(
                """INSERT INTO service_minute_snapshots(
                       timestamp, minute_bucket, service,
                       request_count, error_count, error_rate,
                       avg_latency_ms, p50_latency_ms,
                       p95_latency_ms, p99_latency_ms, status_5xx)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                svc_rows,
            )
            conn.executemany(
                """INSERT INTO system_minute_snapshots(
                       timestamp, minute_bucket, total_requests,
                       total_errors, error_rate, avg_latency_ms,
                       p50_latency_ms, p95_latency_ms, p99_latency_ms,
                       total_services, total_endpoints)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                sys_rows,
            )
            conn.commit()

        print(
            f"[INFO] HistoryStore: backfilled "
            f"{len(api_rows):,} api + {len(svc_rows):,} service + "
            f"{len(sys_rows):,} system rows ({hours}h)"
        )


if __name__ == "__main__":
    """模块测试：初始化并回填 24h 历史数据"""
    store = HistoryStore.get_instance()
    store.start()
    store.seed_backfill_history(hours=25)

    # 测试查询
    now = datetime.now()
    start = (now - timedelta(hours=24)).isoformat()
    end = now.isoformat()

    print("\n--- Top 5 slowest endpoints (last 24h) ---")
    df = store.query_api_stats(
        start, end, group_by="endpoint", limit=5,
        order_by="p99_latency_ms", order_desc=True, min_requests=100,
    )
    if len(df):
        print(df[["service", "endpoint", "request_count", "p99_latency_ms", "error_rate_pct"]].to_string(index=False))

    print("\n--- Timeseries (last 24h, hourly) ---")
    df2 = store.query_timeseries(start, end, granularity="hour")
    if len(df2):
        print(df2.head(10).to_string(index=False))

    print("\n--- DB Stats ---")
    print(store.get_stats())

    store.stop()
