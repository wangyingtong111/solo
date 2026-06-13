import threading
import time
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Dict, List, Optional

import pandas as pd
import numpy as np

try:
    import dask.dataframe as dd
    DASK_AVAILABLE = True
except ImportError:
    DASK_AVAILABLE = False

import config


class SlidingWindowAggregator:
    def __init__(self, window_seconds: int = config.SLIDING_WINDOW_SECONDS):
        self.window_seconds = window_seconds
        self._lock = threading.Lock()
        self._raw_buffer: List[dict] = []
        self._last_aggregation_time = 0
        self._cached_api_metrics: Dict = {}
        self._cached_service_metrics: Dict = {}
        self._cached_timeseries: Dict = {}
        self._total_log_count = 0
        self._error_log_count = 0

    def ingest(self, logs: List[dict]):
        if not logs:
            return
        with self._lock:
            self._raw_buffer.extend(logs)
            self._total_log_count += len(logs)
            self._error_log_count += sum(1 for l in logs if l.get("status_code", 200) >= 400)

            now = time.time()
            cutoff = now - self.window_seconds
            self._raw_buffer = [
                l for l in self._raw_buffer
                if self._parse_ts(l.get("timestamp", "")) > cutoff
            ]

    def _parse_ts(self, ts_str: str) -> float:
        try:
            dt = datetime.strptime(ts_str[:23], "%Y-%m-%dT%H:%M:%S.%f")
            return dt.timestamp()
        except Exception:
            return time.time()

    def aggregate(self) -> dict:
        with self._lock:
            if not self._raw_buffer:
                return self._build_empty_result()

            df = pd.DataFrame(self._raw_buffer)
            df["timestamp_dt"] = pd.to_datetime(df["timestamp"], format="mixed", utc=True)
            df["is_error"] = df["status_code"] >= 400
            df["response_time_ms"] = pd.to_numeric(df["response_time_ms"], errors="coerce")

            api_metrics = self._aggregate_api_metrics(df)
            service_metrics = self._aggregate_service_metrics(df)
            timeseries = self._aggregate_timeseries(df)

            self._cached_api_metrics = api_metrics
            self._cached_service_metrics = service_metrics
            self._cached_timeseries = timeseries

            return {
                "api_metrics": api_metrics,
                "service_metrics": service_metrics,
                "timeseries": timeseries,
                "total_logs": self._total_log_count,
                "error_logs": self._error_log_count,
                "window_size": self.window_seconds,
                "buffer_size": len(self._raw_buffer),
            }

    def _aggregate_api_metrics(self, df: pd.DataFrame) -> dict:
        grouped = df.groupby("endpoint")
        results = {}
        for endpoint, group in grouped:
            total = len(group)
            errors = group["is_error"].sum()
            error_rate = errors / total if total > 0 else 0
            rt = group["response_time_ms"].dropna()

            results[endpoint] = {
                "total_requests": total,
                "error_count": int(errors),
                "error_rate": round(error_rate, 4),
                "p50": round(rt.quantile(0.50), 2) if len(rt) > 0 else 0,
                "p90": round(rt.quantile(0.90), 2) if len(rt) > 0 else 0,
                "p95": round(rt.quantile(0.95), 2) if len(rt) > 0 else 0,
                "p99": round(rt.quantile(0.99), 2) if len(rt) > 0 else 0,
                "avg_rt": round(rt.mean(), 2) if len(rt) > 0 else 0,
                "max_rt": round(rt.max(), 2) if len(rt) > 0 else 0,
                "min_rt": round(rt.min(), 2) if len(rt) > 0 else 0,
            }
        return results

    def _aggregate_service_metrics(self, df: pd.DataFrame) -> dict:
        grouped = df.groupby("source_service")
        results = {}
        for service, group in grouped:
            total = len(group)
            errors = group["is_error"].sum()
            rt = group["response_time_ms"].dropna()

            downstream = group[group["target_service"].notna()].groupby("target_service").size().to_dict()

            results[service] = {
                "total_requests": total,
                "error_count": int(errors),
                "error_rate": round(errors / total, 4) if total > 0 else 0,
                "avg_rt": round(rt.mean(), 2) if len(rt) > 0 else 0,
                "p99_rt": round(rt.quantile(0.99), 2) if len(rt) > 0 else 0,
                "downstream_calls": downstream,
            }
        return results

    def _aggregate_timeseries(self, df: pd.DataFrame) -> dict:
        df["time_bucket"] = df["timestamp_dt"].dt.floor("10s")
        grouped = df.groupby("time_bucket")

        timestamps = []
        request_counts = []
        error_counts = []
        avg_response_times = []

        for ts, group in sorted(grouped, key=lambda x: x[0]):
            timestamps.append(ts.strftime("%Y-%m-%d %H:%M:%S"))
            request_counts.append(len(group))
            error_counts.append(int(group["is_error"].sum()))
            avg_response_times.append(round(group["response_time_ms"].mean(), 2))

        return {
            "timestamps": timestamps,
            "request_counts": request_counts,
            "error_counts": error_counts,
            "avg_response_times": avg_response_times,
        }

    def _build_empty_result(self) -> dict:
        return {
            "api_metrics": {},
            "service_metrics": {},
            "timeseries": {"timestamps": [], "request_counts": [], "error_counts": [], "avg_response_times": []},
            "total_logs": self._total_log_count,
            "error_logs": self._error_log_count,
            "window_size": self.window_seconds,
            "buffer_size": 0,
        }

    def get_cached(self) -> dict:
        with self._lock:
            if self._cached_api_metrics:
                return {
                    "api_metrics": self._cached_api_metrics,
                    "service_metrics": self._cached_service_metrics,
                    "timeseries": self._cached_timeseries,
                    "total_logs": self._total_log_count,
                    "error_logs": self._error_log_count,
                    "window_size": self.window_seconds,
                    "buffer_size": len(self._raw_buffer),
                }
            return self._build_empty_result()

    def query_logs(self, filters: dict, limit: int = 100) -> list:
        with self._lock:
            if not self._raw_buffer:
                return []

            results = self._raw_buffer
            if "service" in filters:
                results = [l for l in results if l.get("source_service") == filters["service"]]
            if "endpoint" in filters:
                results = [l for l in results if l.get("endpoint") == filters["endpoint"]]
            if "trace_id" in filters:
                results = [l for l in results if l.get("trace_id") == filters["trace_id"]]
            if "status_code_min" in filters:
                results = [l for l in results if l.get("status_code", 0) >= filters["status_code_min"]]
            if "min_rt" in filters:
                results = [l for l in results if l.get("response_time_ms", 0) >= filters["min_rt"]]
            if "time_from" in filters:
                results = [l for l in results if l.get("timestamp", "") >= filters["time_from"]]
            if "time_to" in filters:
                results = [l for l in results if l.get("timestamp", "") <= filters["time_to"]]

            return results[:limit]


class DaskBatchAggregator:
    def __init__(self):
        self._client = None

    def _ensure_client(self):
        if self._client is None:
            try:
                from dask.distributed import Client, LocalCluster
                cluster = LocalCluster(n_workers=config.DASK_WORKERS, threads_per_worker=2, memory_limit="2GB")
                self._client = Client(cluster)
            except Exception:
                from dask.distributed import Client
                self._client = Client(processes=False)

    def aggregate_large_dataset(self, df: pd.DataFrame) -> dict:
        if len(df) < 10000:
            return self._pandas_aggregate(df)

        self._ensure_client()
        ddf = dd.from_pandas(df, npartitions=config.DASK_WORKERS)
        ddf["is_error"] = ddf["status_code"] >= 400
        ddf["response_time_ms"] = ddf["response_time_ms"].astype(float)

        api_stats = ddf.groupby("endpoint").agg({
            "status_code": "count",
            "is_error": "sum",
            "response_time_ms": ["mean", "quantile"],
        }).compute()

        return {"api_stats": api_stats.to_dict()}

    def _pandas_aggregate(self, df: pd.DataFrame) -> dict:
        df["is_error"] = df["status_code"] >= 400
        grouped = df.groupby("endpoint").agg(
            total=("status_code", "count"),
            errors=("is_error", "sum"),
            avg_rt=("response_time_ms", "mean"),
        )
        return {"api_stats": grouped.to_dict()}
