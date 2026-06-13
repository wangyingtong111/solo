import threading
import time
from datetime import datetime
from collections import defaultdict, deque
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy import stats

import config


@dataclass
class AnomalyEvent:
    id: str
    timestamp: str
    anomaly_type: str
    severity: str
    service: str
    endpoint: Optional[str]
    metric: str
    current_value: float
    threshold: float
    description: str
    z_score: Optional[float]


class AnomalyDetector:
    def __init__(self, zscore_threshold: float = config.ANOMALY_ZSCORE_THRESHOLD):
        self.zscore_threshold = zscore_threshold
        self._lock = threading.Lock()
        self._metric_history: Dict[str, deque] = defaultdict(lambda: deque(maxlen=200))
        self._anomaly_history: List[AnomalyEvent] = deque(maxlen=500)
        self._suppressed_alerts: Dict[str, float] = {}

    def update_and_detect(self, api_metrics: Dict, service_metrics: Dict) -> List[AnomalyEvent]:
        events = []

        for endpoint, metrics in api_metrics.items():
            metric_keys = ["error_rate", "p99", "avg_rt"]
            for metric_key in metric_keys:
                value = metrics.get(metric_key, 0)
                hist_key = f"api:{endpoint}:{metric_key}"
                self._metric_history[hist_key].append(value)
                event = self._check_anomaly(hist_key, value, endpoint, "API", metric_key)
                if event:
                    events.append(event)

        for service, metrics in service_metrics.items():
            metric_keys = ["error_rate", "p99_rt"]
            for metric_key in metric_keys:
                value = metrics.get(metric_key, 0)
                hist_key = f"service:{service}:{metric_key}"
                self._metric_history[hist_key].append(value)
                event = self._check_anomaly(hist_key, value, service, "SERVICE", metric_key)
                if event:
                    events.append(event)

        events.extend(self._detect_pattern_anomalies(api_metrics, service_metrics))

        with self._lock:
            filtered = []
            now = time.time()
            for e in events:
                if self._suppressed_alerts.get(e.id, 0) > now:
                    continue
                self._suppressed_alerts[e.id] = now + 60
                self._anomaly_history.append(e)
                filtered.append(e)
            return filtered

    def _check_anomaly(self, hist_key: str, value: float, entity: str, entity_type: str, metric_key: str) -> Optional[AnomalyEvent]:
        history = list(self._metric_history[hist_key])
        if len(history) < 15:
            return None

        recent = history[-100:]
        mean = np.mean(recent)
        std = np.std(recent)

        if std < 1e-9:
            return None

        z_score = (value - mean) / std
        is_anomaly = abs(z_score) >= self.zscore_threshold

        if is_anomaly:
            severity = "critical" if abs(z_score) >= 5 else ("high" if abs(z_score) >= 4 else "medium")
            direction = "spike" if z_score > 0 else "drop"

            event = AnomalyEvent(
                id=f"{hist_key}:{int(time.time())}",
                timestamp=datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
                anomaly_type=f"{metric_key}_{direction}",
                severity=severity,
                service=entity,
                endpoint=entity if entity_type == "API" else None,
                metric=metric_key,
                current_value=round(value, 4),
                threshold=round(mean + self.zscore_threshold * std, 4),
                description=f"{entity_type} {entity} {metric_key} {direction} detected (z={z_score:.2f})",
                z_score=round(z_score, 2),
            )
            return event

        return None

    def _detect_pattern_anomalies(self, api_metrics: Dict, service_metrics: Dict) -> List[AnomalyEvent]:
        events = []
        now = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

        high_error_apis = [(ep, m) for ep, m in api_metrics.items() if m.get("error_rate", 0) > 0.1]
        if len(high_error_apis) >= 3:
            affected = [ep for ep, _ in high_error_apis]
            events.append(AnomalyEvent(
                id=f"systemic_error:{int(time.time())}",
                timestamp=now,
                anomaly_type="systemic_error_outbreak",
                severity="critical",
                service="SYSTEM",
                endpoint=None,
                metric="systemic_error_rate",
                current_value=len(high_error_apis),
                threshold=3.0,
                description=f"Systemic error outbreak detected: {len(high_error_apis)} APIs have >10% error rate: {', '.join(affected[:5])}",
                z_score=None,
            ))

        high_latency_apis = [(ep, m) for ep, m in api_metrics.items() if m.get("p99", 0) > 3000]
        if len(high_latency_apis) >= 5:
            events.append(AnomalyEvent(
                id=f"latency_spike:{int(time.time())}",
                timestamp=now,
                anomaly_type="systemic_latency_spike",
                severity="high",
                service="SYSTEM",
                endpoint=None,
                metric="systemic_p99",
                current_value=len(high_latency_apis),
                threshold=5.0,
                description=f"Systemic latency spike: {len(high_latency_apis)} APIs have P99 > 3s",
                z_score=None,
            ))

        return events

    def get_recent_anomalies(self, limit: int = 50) -> List[dict]:
        with self._lock:
            return [self._event_to_dict(e) for e in list(self._anomaly_history)[-limit:]]

    def _event_to_dict(self, e: AnomalyEvent) -> dict:
        return {
            "id": e.id,
            "timestamp": e.timestamp,
            "type": e.anomaly_type,
            "severity": e.severity,
            "service": e.service,
            "endpoint": e.endpoint,
            "metric": e.metric,
            "value": e.current_value,
            "threshold": e.threshold,
            "description": e.description,
            "z_score": e.z_score,
        }

    def get_metric_baseline(self, key: str) -> Optional[dict]:
        hist = list(self._metric_history.get(key, []))
        if len(hist) < 10:
            return None
        return {
            "mean": round(np.mean(hist), 4),
            "std": round(np.std(hist), 4),
            "min": round(np.min(hist), 4),
            "max": round(np.max(hist), 4),
            "p50": round(np.percentile(hist, 50), 4),
            "p95": round(np.percentile(hist, 95), 4),
        }
