import threading
import time
from datetime import datetime
from collections import defaultdict, deque
from typing import Dict, List, Optional, Set, Tuple
from dataclasses import dataclass, field

import config


@dataclass
class TraceSpan:
    span_id: str
    trace_id: str
    parent_span_id: Optional[str]
    source_service: str
    target_service: Optional[str]
    method: str
    endpoint: str
    status_code: int
    response_time_ms: float
    timestamp: str
    error_message: Optional[str]
    children: List["TraceSpan"] = field(default_factory=list)


@dataclass
class ServiceEdge:
    source: str
    target: str
    call_count: int = 0
    error_count: int = 0
    avg_response_time: float = 0.0
    total_response_time: float = 0.0


class DependencyGraph:
    def __init__(self):
        self._lock = threading.Lock()
        self._edges: Dict[Tuple[str, str], ServiceEdge] = {}
        self._traces: Dict[str, List[dict]] = defaultdict(list)
        self._recent_traces: deque = deque(maxlen=1000)
        self._services: Set[str] = set(config.SERVICES)
        self._last_update = 0

    def ingest(self, logs: List[dict]):
        with self._lock:
            for log in logs:
                source = log.get("source_service")
                target = log.get("target_service")
                trace_id = log.get("trace_id")

                if target:
                    key = (source, target)
                    if key not in self._edges:
                        self._edges[key] = ServiceEdge(source=source, target=target)

                    edge = self._edges[key]
                    edge.call_count += 1
                    is_error = log.get("status_code", 200) >= 400
                    if is_error:
                        edge.error_count += 1
                    rt = log.get("response_time_ms", 0)
                    edge.total_response_time += rt
                    edge.avg_response_time = edge.total_response_time / edge.call_count

                if trace_id:
                    self._traces[trace_id].append(log)
                    if len(self._traces[trace_id]) == 1:
                        self._recent_traces.append(trace_id)
                    if len(self._traces) > 5000:
                        old_trace = self._recent_traces.popleft()
                        if old_trace in self._traces:
                            del self._traces[old_trace]

            self._last_update = time.time()

    def get_cytoscape_graph(self) -> Dict:
        with self._lock:
            nodes = []
            edges = []

            service_metrics = defaultdict(lambda: {"in": 0, "out": 0, "errors": 0})
            for (src, tgt), edge in self._edges.items():
                service_metrics[src]["out"] += edge.call_count
                service_metrics[src]["errors"] += edge.error_count
                service_metrics[tgt]["in"] += edge.call_count

            for service in self._services:
                metrics = service_metrics.get(service, {"in": 0, "out": 0, "errors": 0})
                total_calls = metrics["in"] + metrics["out"]
                error_rate = metrics["errors"] / metrics["out"] if metrics["out"] > 0 else 0

                if error_rate > 0.1:
                    color = "#ef4444"
                elif error_rate > 0.05:
                    color = "#f59e0b"
                else:
                    color = "#10b981"

                size = 30 + min(70, total_calls / 100)
                nodes.append({
                    "data": {
                        "id": service,
                        "label": service,
                        "calls_in": metrics["in"],
                        "calls_out": metrics["out"],
                        "total_calls": total_calls,
                        "error_count": metrics["errors"],
                        "error_rate": round(error_rate, 4),
                        "color": color,
                        "size": size,
                    }
                })

            for (src, tgt), edge in self._edges.items():
                error_rate = edge.error_count / edge.call_count if edge.call_count > 0 else 0
                if error_rate > 0.1:
                    color = "#ef4444"
                elif error_rate > 0.05:
                    color = "#f59e0b"
                else:
                    color = "#3b82f6"

                width = 1 + min(10, edge.call_count / 500)
                edges.append({
                    "data": {
                        "id": f"{src}-{tgt}",
                        "source": src,
                        "target": tgt,
                        "call_count": edge.call_count,
                        "error_count": edge.error_count,
                        "error_rate": round(error_rate, 4),
                        "avg_rt": round(edge.avg_response_time, 2),
                        "color": color,
                        "width": width,
                    }
                })

            return {"nodes": nodes, "edges": edges}

    def get_trace_tree(self, trace_id: str) -> Optional[Dict]:
        with self._lock:
            if trace_id not in self._traces:
                return None

            spans = self._traces[trace_id]
            span_map: Dict[str, TraceSpan] = {}
            roots: List[TraceSpan] = []

            for log in spans:
                span = TraceSpan(
                    span_id=log.get("span_id", ""),
                    trace_id=log.get("trace_id", ""),
                    parent_span_id=log.get("parent_span_id"),
                    source_service=log.get("source_service", ""),
                    target_service=log.get("target_service"),
                    method=log.get("method", ""),
                    endpoint=log.get("endpoint", ""),
                    status_code=log.get("status_code", 200),
                    response_time_ms=log.get("response_time_ms", 0),
                    timestamp=log.get("timestamp", ""),
                    error_message=log.get("error_message"),
                )
                span_map[span.span_id] = span

            for span in span_map.values():
                if span.parent_span_id and span.parent_span_id in span_map:
                    span_map[span.parent_span_id].children.append(span)
                else:
                    roots.append(span)

            total_time = max(
                (s.response_time_ms for s in span_map.values()), default=0
            )

            return {
                "trace_id": trace_id,
                "root_spans": [self._span_to_dict(r) for r in roots],
                "span_count": len(span_map),
                "total_response_time_ms": round(total_time, 2),
                "has_error": any(s.status_code >= 400 for s in span_map.values()),
            }

    def _span_to_dict(self, span: TraceSpan) -> dict:
        return {
            "span_id": span.span_id,
            "source": span.source_service,
            "target": span.target_service,
            "method": span.method,
            "endpoint": span.endpoint,
            "status": span.status_code,
            "rt": round(span.response_time_ms, 2),
            "timestamp": span.timestamp,
            "error": span.error_message,
            "children": [self._span_to_dict(c) for c in span.children],
        }

    def search_traces(
        self,
        min_duration: Optional[float] = None,
        has_error: Optional[bool] = None,
        service: Optional[str] = None,
        limit: int = 50,
    ) -> List[dict]:
        with self._lock:
            results = []
            count = 0

            for trace_id in reversed(list(self._recent_traces)):
                if count >= limit:
                    break

                spans = self._traces.get(trace_id, [])
                if not spans:
                    continue

                total_rt = max((s.get("response_time_ms", 0) for s in spans), default=0)
                trace_has_error = any(s.get("status_code", 200) >= 400 for s in spans)
                services_in_trace = set(s.get("source_service") for s in spans)

                if min_duration and total_rt < min_duration:
                    continue
                if has_error is not None and trace_has_error != has_error:
                    continue
                if service and service not in services_in_trace:
                    continue

                results.append({
                    "trace_id": trace_id,
                    "span_count": len(spans),
                    "total_rt": round(total_rt, 2),
                    "has_error": trace_has_error,
                    "services": list(services_in_trace),
                    "start_time": spans[0].get("timestamp") if spans else "",
                })
                count += 1

            return results

    def get_metrics(self) -> Dict:
        with self._lock:
            total_edges = len(self._edges)
            total_calls = sum(e.call_count for e in self._edges.values())
            total_errors = sum(e.error_count for e in self._edges.values())
            avg_rt = (
                sum(e.avg_response_time * e.call_count for e in self._edges.values()) / total_calls
                if total_calls > 0 else 0
            )
            return {
                "service_count": len(self._services),
                "edge_count": total_edges,
                "total_calls": total_calls,
                "total_errors": total_errors,
                "average_response_time_ms": round(avg_rt, 2),
                "traces_tracked": len(self._traces),
                "last_update": datetime.fromtimestamp(self._last_update).strftime("%Y-%m-%d %H:%M:%S") if self._last_update else "",
            }

    def get_service_list(self) -> List[str]:
        with self._lock:
            return sorted(self._services)
