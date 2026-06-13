import re
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Callable, Any
from dataclasses import dataclass

import pandas as pd

try:
    import jieba
    jieba.initialize()
    JIEBA_AVAILABLE = True
except ImportError:
    JIEBA_AVAILABLE = False

import config


@dataclass
class ParsedQuery:
    raw_query: str
    intent: str
    entity_type: str
    metric: str
    time_range: Optional[Dict]
    service: Optional[str]
    limit: int
    sort_by: str
    sort_order: str
    filters: Dict


class NLQueryEngine:
    def __init__(self):
        self._time_keywords = {
            "今天": (0, 0),
            "昨天": (-1, -1),
            "前天": (-2, -2),
            "上周": (-7, -1),
            "过去7天": (-7, 0),
            "过去30天": (-30, 0),
            "本周": (-7, 0),
            "本月": (-30, 0),
        }
        self._period_keywords = {
            "早上": (6, 12),
            "上午": (8, 12),
            "中午": (11, 14),
            "下午": (14, 18),
            "晚上": (18, 22),
            "凌晨": (0, 6),
            "傍晚": (17, 20),
            "整晚": (20, 24),
        }
        self._metric_keywords = {
            "最慢": ("avg_rt", "desc"),
            "最快": ("avg_rt", "asc"),
            "最慢的": ("avg_rt", "desc"),
            "最快的": ("avg_rt", "asc"),
            "错误最多": ("error_count", "desc"),
            "错误率最高": ("error_rate", "desc"),
            "错误最少": ("error_count", "asc"),
            "调用最多": ("total_requests", "desc"),
            "访问最多": ("total_requests", "desc"),
            "最忙": ("total_requests", "desc"),
            "最空闲": ("total_requests", "asc"),
            "p99最高": ("p99", "desc"),
            "p99最高的": ("p99", "desc"),
            "响应最慢": ("p99", "desc"),
        }
        self._entity_keywords = {
            "接口": "api",
            "API": "api",
            "api": "api",
            "服务": "service",
            "节点": "service",
            "系统": "service",
        }
        self._intent_keywords = {
            "查询": "query",
            "显示": "query",
            "展示": "query",
            "找": "query",
            "给我": "query",
            "列出": "query",
            "统计": "stats",
            "分析": "analyze",
            "对比": "compare",
            "比较": "compare",
        }
        jieba.initialize()

    def parse(self, query: str) -> ParsedQuery:
        q = query.strip()
        intent = "query"
        for kw, it in self._intent_keywords.items():
            if kw in q:
                intent = it
                break

        entity_type = "api"
        for kw, et in self._entity_keywords.items():
            if kw in q:
                entity_type = et
                break

        metric = "total_requests"
        sort_order = "desc"
        for kw, (mt, so) in self._metric_keywords.items():
            if kw in q:
                metric = mt
                sort_order = so
                break

        time_range = self._parse_time_range(q)
        service = self._parse_service(q)
        limit = self._parse_limit(q)

        sort_by = metric
        for kw in ["按错误率", "按响应时间", "按调用量", "按P99"]:
            if kw in q:
                if "错误率" in kw:
                    sort_by = "error_rate"
                elif "响应" in kw:
                    sort_by = "p99"
                elif "调用" in kw:
                    sort_by = "total_requests"
                elif "P99" in kw or "p99" in kw:
                    sort_by = "p99"
                break

        return ParsedQuery(
            raw_query=q,
            intent=intent,
            entity_type=entity_type,
            metric=metric,
            time_range=time_range,
            service=service,
            limit=limit,
            sort_by=sort_by,
            sort_order=sort_order,
            filters={},
        )

    def _parse_time_range(self, query: str) -> Optional[Dict]:
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        from_dt = None
        to_dt = None

        for kw, (days_from, days_to) in self._time_keywords.items():
            if kw in query:
                from_dt = today + timedelta(days=days_from)
                to_dt = today + timedelta(days=days_to + 1)
                break

        for kw, (start_hour, end_hour) in self._period_keywords.items():
            if kw in query:
                if from_dt is None:
                    from_dt = today
                if to_dt is None:
                    to_dt = today + timedelta(days=1)
                from_dt = from_dt.replace(hour=start_hour)
                to_dt = to_dt.replace(hour=end_hour) if end_hour < 24 else to_dt.replace(hour=23, minute=59, second=59)
                break

        if from_dt is not None and to_dt is not None:
            return {
                "from": from_dt.strftime("%Y-%m-%d %H:%M:%S"),
                "to": to_dt.strftime("%Y-%m-%d %H:%M:%S"),
                "from_dt": from_dt,
                "to_dt": to_dt,
            }

        matches = re.search(r"(\d+)\s*(分钟|小时|天|周|月)前", query)
        if matches:
            num = int(matches.group(1))
            unit = matches.group(2)
            to_dt = datetime.now()
            if unit == "分钟":
                from_dt = to_dt - timedelta(minutes=num)
            elif unit == "小时":
                from_dt = to_dt - timedelta(hours=num)
            elif unit == "天":
                from_dt = to_dt - timedelta(days=num)
            elif unit == "周":
                from_dt = to_dt - timedelta(weeks=num)
            elif unit == "月":
                from_dt = to_dt - timedelta(days=num * 30)

            return {
                "from": from_dt.strftime("%Y-%m-%d %H:%M:%S"),
                "to": to_dt.strftime("%Y-%m-%d %H:%M:%S"),
                "from_dt": from_dt,
                "to_dt": to_dt,
            }

        return None

    def _parse_service(self, query: str) -> Optional[str]:
        if JIEBA_AVAILABLE:
            tokens = jieba.lcut(query)
        else:
            tokens = list(query)
        for service in config.SERVICES:
            if service in tokens or service in query:
                return service
        return None

    def _parse_limit(self, query: str) -> int:
        matches = re.search(r"前\s*(\d+)|top\s*(\d+)|(\d+)\s*个", query, re.IGNORECASE)
        if matches:
            for g in matches.groups():
                if g:
                    return int(g)
        return 10

    def execute(self, parsed: ParsedQuery, api_metrics: Dict, service_metrics: Dict) -> Dict:
        if parsed.entity_type == "api":
            data = self._filter_api_metrics(api_metrics, parsed)
        else:
            data = self._filter_service_metrics(service_metrics, parsed)

        if not data:
            return {
                "query": parsed.raw_query,
                "parsed": self._parsed_to_dict(parsed),
                "results": [],
                "chart_type": "bar",
                "title": self._generate_title(parsed),
                "x_key": "name",
                "y_key": parsed.sort_by,
                "description": "No data found",
            }

        sorted_data = sorted(
            data,
            key=lambda x: x.get(parsed.sort_by, 0),
            reverse=(parsed.sort_order == "desc"),
        )[:parsed.limit]

        chart_type = self._determine_chart_type(parsed)

        return {
            "query": parsed.raw_query,
            "parsed": self._parsed_to_dict(parsed),
            "results": sorted_data,
            "chart_type": chart_type,
            "title": self._generate_title(parsed),
            "x_key": "name",
            "y_key": parsed.sort_by,
            "description": self._generate_description(parsed, sorted_data),
        }

    def _filter_api_metrics(self, api_metrics: Dict, parsed: ParsedQuery) -> List[Dict]:
        results = []
        for name, metrics in api_metrics.items():
            item = {"name": name, **metrics}
            if parsed.service:
                continue
            results.append(item)
        return results

    def _filter_service_metrics(self, service_metrics: Dict, parsed: ParsedQuery) -> List[Dict]:
        results = []
        for name, metrics in service_metrics.items():
            item = {"name": name, **metrics}
            if parsed.service and name != parsed.service:
                continue
            results.append(item)
        return results

    def _determine_chart_type(self, parsed: ParsedQuery) -> str:
        if parsed.metric in ["avg_rt", "p99", "p95", "p50"]:
            return "bar"
        elif parsed.metric in ["error_rate"]:
            return "bar"
        elif parsed.metric in ["total_requests"]:
            return "pie"
        return "bar"

    def _generate_title(self, parsed: ParsedQuery) -> str:
        metric_names = {
            "avg_rt": "平均响应时间",
            "p50": "P50 响应时间",
            "p90": "P90 响应时间",
            "p95": "P95 响应时间",
            "p99": "P99 响应时间",
            "error_rate": "错误率",
            "error_count": "错误数",
            "total_requests": "请求总数",
        }
        metric_name = metric_names.get(parsed.sort_by, parsed.sort_by)
        entity_name = "API接口" if parsed.entity_type == "api" else "服务"
        time_desc = ""
        if parsed.time_range:
            time_desc = f" ({parsed.time_range['from']} 至 {parsed.time_range['to']})"

        return f"前{parsed.limit}个{metric_name}{'最高' if parsed.sort_order == 'desc' else '最低'}的{entity_name}{time_desc}"

    def _generate_description(self, parsed: ParsedQuery, data: List[Dict]) -> str:
        if not data:
            return "未找到匹配的数据"

        top_val = data[0].get(parsed.sort_by, 0)
        avg_val = sum(d.get(parsed.sort_by, 0) for d in data) / len(data)

        metric_names = {
            "avg_rt": "平均响应时间",
            "p99": "P99响应时间",
            "p95": "P95响应时间",
            "error_rate": "错误率",
            "error_count": "错误数",
            "total_requests": "请求总数",
        }
        metric_name = metric_names.get(parsed.sort_by, parsed.sort_by)

        return (
            f"查询到 {len(data)} 条记录，{metric_name}最高为 {top_val}，"
            f"平均为 {avg_val:.2f}。"
        )

    def _parsed_to_dict(self, parsed: ParsedQuery) -> Dict:
        return {
            "raw_query": parsed.raw_query,
            "intent": parsed.intent,
            "entity_type": parsed.entity_type,
            "metric": parsed.metric,
            "time_range": {k: v for k, v in parsed.time_range.items() if k in ["from", "to"]} if parsed.time_range else None,
            "service": parsed.service,
            "limit": parsed.limit,
            "sort_by": parsed.sort_by,
            "sort_order": parsed.sort_order,
        }
