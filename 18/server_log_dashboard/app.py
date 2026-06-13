import os
import sys
import time
import threading
from datetime import datetime
from collections import deque

import dash
from dash import dcc, html, Input, Output, State, callback_context
import dash_cytoscape as cyto
import plotly.graph_objects as go
import plotly.express as px
import pandas as pd
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config
from kafka_consumer import KafkaConsumerAdapter
from aggregation import SlidingWindowAggregator
from anomaly_detector import AnomalyDetector
from forecaster import ProphetForecaster
from dependency_graph import DependencyGraph
from nlp_query import NLQueryEngine
from report_generator import ReportGenerator
from websocket_handler import WebSocketManager


CARD_STYLE = {
    "backgroundColor": "white",
    "borderRadius": "12px",
    "boxShadow": "0 1px 3px rgba(0,0,0,0.1)",
    "padding": "20px",
    "marginBottom": "16px",
}

TITLE_STYLE = {
    "fontSize": "18px",
    "fontWeight": "600",
    "marginBottom": "12px",
    "color": "#1E293B",
}

NAV_BTN = {
    "backgroundColor": "#1E293B",
    "color": "white",
    "padding": "10px 20px",
    "fontSize": "14px",
    "cursor": "pointer",
    "border": "none",
    "borderRadius": "8px",
    "marginRight": "6px",
    "transition": "all 0.3s",
}

NAV_BTN_ACTIVE = {
    "backgroundColor": "#3B82F6",
    "color": "white",
    "padding": "10px 20px",
    "fontSize": "14px",
    "cursor": "pointer",
    "border": "none",
    "borderRadius": "8px",
    "marginRight": "6px",
    "transition": "all 0.3s",
}


class LogDashboard:
    def __init__(self):
        self.app = dash.Dash(
            __name__,
            title="企业级服务器日志监控仪表盘",
            suppress_callback_exceptions=True,
            external_scripts=[
                "https://cdn.plot.ly/plotly-2.35.2.min.js",
            ],
        )
        self.server = self.app.server

        self.ws_manager = WebSocketManager()
        self.ws_enabled = self.ws_manager.init_app(self.server)

        self.consumer = KafkaConsumerAdapter(use_real_kafka=False)
        self.aggregator = SlidingWindowAggregator(window_seconds=config.SLIDING_WINDOW_SECONDS)
        self.anomaly_detector = AnomalyDetector()
        self.forecaster = ProphetForecaster()
        self.dep_graph = DependencyGraph()
        self.nlp_engine = NLQueryEngine()
        self.report_gen = ReportGenerator()

        self._running = False
        self._consume_thread = None
        self._aggregate_thread = None
        self._forecast_thread = None
        self._active_page = "overview"

        self._setup_layout()
        self._setup_callbacks()

    def _setup_layout(self):
        self.app.layout = html.Div([
            dcc.Store(id="realtime-store", data={}),
            dcc.Store(id="page-store", data="overview"),
            dcc.Interval(id="realtime-interval", interval=2000, n_intervals=0),
            dcc.Interval(id="forecast-interval", interval=30000, n_intervals=0),

            html.Div([
                html.Div([
                    html.H1("📊 企业级服务器日志监控仪表盘", style={
                        "color": "white",
                        "margin": "0",
                        "fontSize": "22px",
                        "fontWeight": "700",
                    }),
                    html.Div([
                        html.Span("● LIVE", style={
                            "color": "#10B981",
                            "fontSize": "13px",
                            "fontWeight": "600",
                            "marginLeft": "16px",
                            "backgroundColor": "rgba(16, 185, 129, 0.2)",
                            "padding": "4px 12px",
                            "borderRadius": "20px",
                        }),
                    ], style={"display": "flex", "alignItems": "center"}),
                ], style={"display": "flex", "alignItems": "center"}),
                html.Div([
                    html.Button("📈 实时监控", id="btn-overview", n_clicks=0, style=NAV_BTN_ACTIVE),
                    html.Button("🔍 调用链", id="btn-tracing", n_clicks=0, style=NAV_BTN),
                    html.Button("🧠 智能分析", id="btn-analytics", n_clicks=0, style=NAV_BTN),
                    html.Button("💬 NLP查询", id="btn-nlp", n_clicks=0, style=NAV_BTN),
                    html.Button("📑 报告导出", id="btn-report", n_clicks=0, style=NAV_BTN),
                    html.Button("⚙️ 设置", id="btn-settings", n_clicks=0, style=NAV_BTN),
                ]),
            ], style={
                "backgroundColor": "#0F172A",
                "padding": "14px 28px",
                "display": "flex",
                "justifyContent": "space-between",
                "alignItems": "center",
            }),

            html.Div(id="main-content", style={
                "padding": "20px 28px",
                "backgroundColor": "#F1F5F9",
                "minHeight": "calc(100vh - 72px)",
            }),

            dcc.Download(id="download-report"),
        ], style={"fontFamily": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"})

    def _setup_callbacks(self):
        self.app.callback(
            Output("main-content", "children"),
            Output("page-store", "data"),
            [
                Input("btn-overview", "n_clicks"),
                Input("btn-tracing", "n_clicks"),
                Input("btn-analytics", "n_clicks"),
                Input("btn-nlp", "n_clicks"),
                Input("btn-report", "n_clicks"),
                Input("btn-settings", "n_clicks"),
            ],
            prevent_initial_call=False,
        )(self._render_page)

        self.app.callback(
            [
                Output("overview-stats", "children"),
                Output("realtime-chart", "figure"),
                Output("api-error-chart", "figure"),
                Output("api-latency-chart", "figure"),
                Output("anomaly-list", "children"),
                Output("service-deps-graph", "elements"),
                Output("graph-stats", "children"),
            ],
            [Input("realtime-interval", "n_intervals")],
            prevent_initial_call=False,
        )(self._update_overview)

        self.app.callback(
            Output("forecast-chart", "figure"),
            Output("forecast-alerts", "children"),
            [Input("forecast-interval", "n_intervals")],
            prevent_initial_call=False,
        )(self._update_forecast)

        self.app.callback(
            Output("trace-details", "children"),
            Input("trace-search-btn", "n_clicks"),
            State("trace-search-input", "value"),
            State("trace-min-duration", "value"),
            State("trace-error-only", "value"),
            prevent_initial_call=False,
        )(self._handle_trace_search)

        self.app.callback(
            Output("nlp-result", "children"),
            Output("nlp-chart", "figure"),
            Input("nlp-submit", "n_clicks"),
            State("nlp-input", "value"),
            prevent_initial_call=True,
        )(self._handle_nlp_query)

        self.app.callback(
            Output("download-report", "data"),
            Input("export-ppt", "n_clicks"),
            prevent_initial_call=True,
        )(self._export_report)

    def _render_page(self, btn1, btn2, btn3, btn4, btn5, btn6):
        ctx = callback_context
        if not ctx.triggered:
            return self._render_overview(), "overview"

        btn_id = ctx.triggered[0]["prop_id"].split(".")[0]
        page_map = {
            "btn-overview": (self._render_overview, "overview"),
            "btn-tracing": (self._render_tracing, "tracing"),
            "btn-analytics": (self._render_analytics, "analytics"),
            "btn-nlp": (self._render_nlp, "nlp"),
            "btn-report": (self._render_report, "report"),
            "btn-settings": (self._render_settings, "settings"),
        }
        render_fn, page_name = page_map.get(btn_id, (self._render_overview, "overview"))
        self._active_page = page_name
        return render_fn(), page_name

    def _render_overview(self):
        return html.Div([
            html.Div(id="overview-stats", style={
                "display": "grid",
                "gridTemplateColumns": "repeat(4, 1fr)",
                "gap": "14px",
                "marginBottom": "20px",
            }),
            html.Div([
                html.H3("📈 实时流量与响应时间趋势", style=TITLE_STYLE),
                dcc.Graph(id="realtime-chart", style={"height": "300px"}),
            ], style=CARD_STYLE),
            html.Div([
                html.Div([
                    html.H3("🔴 API 错误率排行", style=TITLE_STYLE),
                    dcc.Graph(id="api-error-chart", style={"height": "280px"}),
                ], style={**CARD_STYLE, "flex": "1", "marginRight": "14px", "marginBottom": "0"}),
                html.Div([
                    html.H3("⏱️ API P99 响应时间排行", style=TITLE_STYLE),
                    dcc.Graph(id="api-latency-chart", style={"height": "280px"}),
                ], style={**CARD_STYLE, "flex": "1", "marginBottom": "0"}),
            ], style={"display": "flex", "marginBottom": "20px"}),
            html.Div([
                html.Div([
                    html.H3("🌐 服务依赖拓扑图", style=TITLE_STYLE),
                    cyto.Cytoscape(
                        id="service-deps-graph",
                        layout={"name": "cose", "animate": False, "nodeRepulsion": 5000},
                        style={"width": "100%", "height": "380px"},
                        stylesheet=[
                            {"selector": "node", "style": {
                                "label": "data(label)",
                                "background-color": "data(color)",
                                "width": "data(size)",
                                "height": "data(size)",
                                "font-size": "11px",
                                "text-valign": "center",
                                "text-halign": "center",
                                "color": "white",
                                "text-outline-width": 2,
                                "text-outline-color": "#333",
                            }},
                            {"selector": "edge", "style": {
                                "curve-style": "bezier",
                                "width": "data(width)",
                                "line-color": "data(color)",
                                "target-arrow-color": "data(color)",
                                "target-arrow-shape": "triangle",
                                "arrow-scale": 1,
                                "opacity": 0.6,
                            }},
                        ],
                    ),
                    html.Div(id="graph-stats", style={
                        "marginTop": "10px",
                        "fontSize": "12px",
                        "color": "#64748B",
                    }),
                ], style={**CARD_STYLE, "flex": "1.5", "marginRight": "14px", "marginBottom": "0"}),
                html.Div([
                    html.H3("⚠️ 异常检测事件", style=TITLE_STYLE),
                    html.Div(id="anomaly-list", style={
                        "maxHeight": "360px",
                        "overflowY": "auto",
                    }),
                ], style={**CARD_STYLE, "flex": "1", "marginBottom": "0"}),
            ], style={"display": "flex"}),
        ])

    def _update_overview(self, n):
        data = self.aggregator.get_cached()
        anomalies = self.anomaly_detector.get_recent_anomalies(limit=20)
        dep_graph = self.dep_graph.get_cytoscape_graph()
        dep_metrics = self.dep_graph.get_metrics()

        stats = self._render_stats_cards(data)
        ts_fig = self._render_timeseries_chart(data.get("timeseries", {}))
        err_fig = self._render_error_rate_chart(data.get("api_metrics", {}))
        lat_fig = self._render_latency_chart(data.get("api_metrics", {}))
        anomaly_list = self._render_anomaly_list(anomalies)
        graph_elements = dep_graph.get("nodes", []) + dep_graph.get("edges", [])

        stats_text = (
            f"服务节点: {dep_metrics.get('service_count', 0)} | "
            f"调用连边: {dep_metrics.get('edge_count', 0)} | "
            f"总调用: {dep_metrics.get('total_calls', 0):,} | "
            f"调用链跟踪: {dep_metrics.get('traces_tracked', 0):,}"
        )

        return stats, ts_fig, err_fig, lat_fig, anomaly_list, graph_elements, stats_text

    def _render_stats_cards(self, data):
        total_logs = data.get("total_logs", 0)
        error_logs = data.get("error_logs", 0)
        error_rate = (error_logs / total_logs * 100) if total_logs > 0 else 0
        dep_metrics = self.dep_graph.get_metrics()
        avg_rt = dep_metrics.get("average_response_time_ms", 0)

        cards = [
            ("总日志处理量", f"{total_logs:,}", "#3B82F6", "📊"),
            ("错误率", f"{error_rate:.2f}%", "#EF4444" if error_rate > 1 else "#10B981", "🚨"),
            ("平均响应时间", f"{avg_rt:.1f} ms", "#F59E0B" if avg_rt > 500 else "#10B981", "⏱️"),
            ("活动服务数", str(dep_metrics.get("service_count", 0)), "#8B5CF6", "🔗"),
        ]

        return [
            html.Div([
                html.Div(icon, style={"fontSize": "28px", "marginRight": "14px"}),
                html.Div([
                    html.Div(label, style={"fontSize": "13px", "color": "#64748B", "marginBottom": "4px"}),
                    html.Div(value, style={"fontSize": "26px", "fontWeight": "700", "color": color}),
                ]),
            ], style={
                "backgroundColor": "white",
                "borderRadius": "12px",
                "padding": "18px",
                "display": "flex",
                "alignItems": "center",
                "boxShadow": "0 1px 3px rgba(0,0,0,0.1)",
                "borderLeft": f"4px solid {color}",
            })
            for label, value, color, icon in cards
        ]

    def _render_timeseries_chart(self, ts_data):
        timestamps = ts_data.get("timestamps", [])
        req_counts = ts_data.get("request_counts", [])
        avg_rts = ts_data.get("avg_response_times", [])

        fig = go.Figure()
        fig.add_trace(go.Bar(
            x=timestamps, y=req_counts,
            name="请求数/10s", yaxis="y",
            marker_color="rgba(59, 130, 246, 0.6)",
            opacity=0.7,
        ))
        fig.add_trace(go.Scatter(
            x=timestamps, y=avg_rts,
            name="平均响应(ms)", yaxis="y2",
            line=dict(color="#F59E0B", width=2),
            mode="lines",
        ))

        fig.update_layout(
            template="plotly_white",
            hovermode="x unified",
            margin=dict(l=50, r=50, t=10, b=40),
            legend=dict(orientation="h", yanchor="bottom", y=1.02),
            yaxis=dict(title="请求数", side="left"),
            yaxis2=dict(title="响应(ms)", side="right", overlaying="y", showgrid=False),
            xaxis=dict(tickangle=45, tickfont=dict(size=10), nticks=10),
        )
        return fig

    def _render_error_rate_chart(self, api_metrics):
        if not api_metrics:
            fig = go.Figure()
            fig.update_layout(template="plotly_white", title="暂无数据")
            return fig

        data = [
            {"name": k, "error_rate": v.get("error_rate", 0) * 100}
            for k, v in api_metrics.items()
        ]
        data.sort(key=lambda x: x["error_rate"], reverse=True)
        data = data[:12]

        colors = []
        for d in data:
            if d["error_rate"] > 5:
                colors.append("#EF4444")
            elif d["error_rate"] > 1:
                colors.append("#F59E0B")
            else:
                colors.append("#10B981")

        fig = go.Figure(go.Bar(
            x=[d["name"] for d in data],
            y=[d["error_rate"] for d in data],
            marker_color=colors,
            text=[f"{d['error_rate']:.1f}%" for d in data],
            textposition="outside",
        ))
        fig.update_layout(
            template="plotly_white",
            margin=dict(l=40, r=20, t=10, b=80),
            yaxis_title="错误率 (%)",
            xaxis=dict(tickangle=45, tickfont=dict(size=9)),
        )
        return fig

    def _render_latency_chart(self, api_metrics):
        if not api_metrics:
            fig = go.Figure()
            fig.update_layout(template="plotly_white", title="暂无数据")
            return fig

        data = [
            {"name": k, "p99": v.get("p99", 0), "p95": v.get("p95", 0), "avg": v.get("avg_rt", 0)}
            for k, v in api_metrics.items()
        ]
        data.sort(key=lambda x: x["p99"], reverse=True)
        data = data[:12]

        fig = go.Figure()
        fig.add_trace(go.Bar(x=[d["name"] for d in data], y=[d["p99"] for d in data], name="P99", marker_color="#EF4444"))
        fig.add_trace(go.Bar(x=[d["name"] for d in data], y=[d["p95"] for d in data], name="P95", marker_color="#F59E0B"))
        fig.add_trace(go.Bar(x=[d["name"] for d in data], y=[d["avg"] for d in data], name="平均", marker_color="#3B82F6"))

        fig.update_layout(
            template="plotly_white",
            barmode="group",
            margin=dict(l=40, r=20, t=10, b=80),
            yaxis_title="响应时间 (ms)",
            legend=dict(orientation="h", yanchor="bottom", y=1.02),
            xaxis=dict(tickangle=45, tickfont=dict(size=9)),
        )
        return fig

    def _render_anomaly_list(self, anomalies):
        if not anomalies:
            return html.Div([
                html.Div("✅", style={"fontSize": "42px", "textAlign": "center", "marginBottom": "10px"}),
                html.Div("暂无异常事件", style={"textAlign": "center", "color": "#64748B", "fontSize": "13px"}),
                html.Div("系统运行正常", style={"textAlign": "center", "color": "#10B981", "fontSize": "11px", "marginTop": "4px"}),
            ], style={"padding": "36px 20px"})

        items = []
        for a in reversed(anomalies):
            sev_colors = {
                "critical": ("#FEF2F2", "#DC2626", "#FCA5A5"),
                "high": ("#FFF7ED", "#EA580C", "#FDBA74"),
                "medium": ("#FEF3C7", "#D97706", "#FCD34D"),
            }
            sev = a.get("severity", "medium")
            bg, color, border = sev_colors.get(sev, sev_colors["medium"])

            items.append(html.Div([
                html.Div([
                    html.Span(sev.upper(), style={
                        "fontSize": "10px", "fontWeight": "700", "color": color,
                        "backgroundColor": bg, "padding": "2px 8px",
                        "borderRadius": "4px", "textTransform": "uppercase",
                    }),
                    html.Span(str(a.get("timestamp", ""))[-8:], style={
                        "fontSize": "10px", "color": "#94A3B8", "marginLeft": "8px",
                    }),
                ], style={"marginBottom": "5px"}),
                html.Div(a.get("description", ""), style={
                    "fontSize": "12px", "color": "#334155", "lineHeight": "1.3",
                }),
                html.Div([
                    html.Span(a.get("service", ""), style={"fontSize": "10px", "color": "#64748B"}),
                    html.Span("  ·  ", style={"color": "#CBD5E1"}),
                    html.Span(f"Z={a.get('z_score', '-')}", style={"fontSize": "10px", "color": "#64748B"}),
                ], style={"marginTop": "5px"}),
            ], style={
                "padding": "10px",
                "borderBottom": "1px solid #E2E8F0",
                "borderLeft": f"3px solid {color}",
                "marginBottom": "6px",
                "backgroundColor": "white",
                "borderRadius": "6px",
            }))

        return html.Div(items)

    def _render_tracing(self):
        return html.Div([
            html.Div([
                html.H3("🔍 调用链追踪", style=TITLE_STYLE),
                html.Div([
                    dcc.Input(
                        id="trace-search-input",
                        type="text",
                        placeholder="输入 Trace ID 精确查询...",
                        style={
                            "flex": "2", "padding": "9px 12px",
                            "border": "1px solid #CBD5E1",
                            "borderRadius": "8px", "fontSize": "13px",
                            "marginRight": "10px",
                        },
                    ),
                    dcc.Input(
                        id="trace-min-duration",
                        type="number",
                        placeholder="最小耗时(ms)",
                        style={
                            "flex": "1", "padding": "9px 12px",
                            "border": "1px solid #CBD5E1",
                            "borderRadius": "8px", "fontSize": "13px",
                            "marginRight": "10px",
                        },
                    ),
                    dcc.Dropdown(
                        id="trace-error-only",
                        options=[
                            {"label": "全部", "value": ""},
                            {"label": "仅错误", "value": "error"},
                        ],
                        value="",
                        style={"flex": "1", "marginRight": "10px"},
                    ),
                    html.Button(
                        "🔍 搜索", id="trace-search-btn", n_clicks=0,
                        style={
                            "padding": "9px 20px",
                            "backgroundColor": "#3B82F6",
                            "color": "white",
                            "border": "none",
                            "borderRadius": "8px",
                            "cursor": "pointer",
                            "fontSize": "13px",
                        },
                    ),
                ], style={"display": "flex", "alignItems": "center"}),
            ], style=CARD_STYLE),
            html.Div([
                html.Div(id="trace-details"),
            ], style=CARD_STYLE),
        ])

    def _handle_trace_search(self, n_clicks, trace_id, min_duration, error_only):
        if trace_id and trace_id.strip():
            trace = self.dep_graph.get_trace_tree(trace_id.strip())
            if trace:
                return self._render_trace_detail(trace)
            return html.Div(f"未找到 Trace: {trace_id}", style={"padding": "30px", "color": "#64748B", "textAlign": "center"})

        traces = self.dep_graph.search_traces(
            min_duration=min_duration if min_duration else None,
            has_error=(error_only == "error") if error_only else None,
            limit=50,
        )
        return self._render_trace_list(traces)

    def _render_trace_list(self, traces):
        if not traces:
            return html.Div("未找到匹配的调用链", style={"padding": "30px", "textAlign": "center", "color": "#64748B"})

        header_row = html.Tr([
            html.Th("Trace ID", style={"textAlign": "left", "padding": "10px", "borderBottom": "2px solid #E2E8F0", "fontSize": "12px"}),
            html.Th("Spans", style={"textAlign": "left", "padding": "10px", "borderBottom": "2px solid #E2E8F0", "fontSize": "12px"}),
            html.Th("总耗时(ms)", style={"textAlign": "left", "padding": "10px", "borderBottom": "2px solid #E2E8F0", "fontSize": "12px"}),
            html.Th("状态", style={"textAlign": "left", "padding": "10px", "borderBottom": "2px solid #E2E8F0", "fontSize": "12px"}),
            html.Th("涉及服务", style={"textAlign": "left", "padding": "10px", "borderBottom": "2px solid #E2E8F0", "fontSize": "12px"}),
            html.Th("开始时间", style={"textAlign": "left", "padding": "10px", "borderBottom": "2px solid #E2E8F0", "fontSize": "12px"}),
        ])

        rows = []
        for t in traces:
            status_color = "#EF4444" if t.get("has_error") else "#10B981"
            status_text = "❌ 错误" if t.get("has_error") else "✅ 正常"
            services = ", ".join(t.get("services", [])[:4])
            if len(t.get("services", [])) > 4:
                services += "..."
            start_time = str(t.get("start_time", ""))[-12:] if t.get("start_time") else ""

            rows.append(html.Tr([
                html.Td(t.get("trace_id", ""), style={"padding": "8px 10px", "borderBottom": "1px solid #E2E8F0", "fontSize": "11px", "fontFamily": "monospace"}),
                html.Td(str(t.get("span_count", 0)), style={"padding": "8px 10px", "borderBottom": "1px solid #E2E8F0", "fontSize": "12px"}),
                html.Td(f"{t.get('total_rt', 0):.1f}", style={"padding": "8px 10px", "borderBottom": "1px solid #E2E8F0", "fontSize": "12px"}),
                html.Td(html.Span(status_text, style={"color": status_color, "fontWeight": "600", "fontSize": "11px"}), style={"padding": "8px 10px", "borderBottom": "1px solid #E2E8F0"}),
                html.Td(services, style={"padding": "8px 10px", "borderBottom": "1px solid #E2E8F0", "fontSize": "11px"}),
                html.Td(start_time, style={"padding": "8px 10px", "borderBottom": "1px solid #E2E8F0", "fontSize": "11px"}),
            ], style={"cursor": "pointer"}))

        return html.Table(
            [html.Thead(header_row), html.Tbody(rows)],
            style={"width": "100%", "borderCollapse": "collapse", "fontSize": "12px"},
        )

    def _render_trace_detail(self, trace):
        def render_span(span_data, depth=0):
            children_html = []
            for child in span_data.get("children", []):
                children_html.append(render_span(child, depth + 1))

            status = span_data.get("status", 200)
            status_color = "#EF4444" if status >= 400 else "#10B981"
            method = span_data.get("method", "")
            source = span_data.get("source", "")
            target = span_data.get("target", "") or "-"
            endpoint = span_data.get("endpoint", "")
            rt = span_data.get("rt", 0)
            err = span_data.get("error", "")

            indent = "  " * depth

            return html.Div([
                html.Div([
                    html.Span(indent + "└─" if depth > 0 else "", style={"color": "#CBD5E1"}),
                    html.Span(method, style={
                        "backgroundColor": "#DBEAFE", "color": "#1D4ED8",
                        "padding": "2px 6px", "borderRadius": "3px",
                        "fontSize": "10px", "fontWeight": "600", "marginRight": "6px",
                    }),
                    html.Span(f"{source} → {target}", style={"fontWeight": "600", "fontSize": "12px", "marginRight": "6px"}),
                    html.Span(endpoint, style={"color": "#64748B", "fontSize": "11px"}),
                    html.Span(str(status), style={
                        "color": "white", "backgroundColor": status_color,
                        "padding": "2px 6px", "borderRadius": "3px",
                        "fontSize": "10px", "fontWeight": "600", "marginLeft": "6px",
                    }),
                    html.Span(f"{rt:.1f}ms", style={
                        "float": "right", "color": "#64748B",
                        "fontSize": "11px", "fontWeight": "500",
                    }),
                ], style={
                    "padding": "7px 10px",
                    "borderBottom": "1px solid #E2E8F0",
                    "fontSize": "12px",
                }),
                html.Div(children_html, style={"marginLeft": "16px"}) if children_html else None,
            ])

        root_spans = trace.get("root_spans", [])
        spans_html = [render_span(s) for s in root_spans]

        return html.Div([
            html.Div([
                html.H4(f"Trace: {trace.get('trace_id', '')}", style={
                    "fontSize": "16px", "marginBottom": "10px", "color": "#1E293B",
                }),
                html.Div([
                    html.Span(f"Spans: {trace.get('span_count', 0)}", style={"marginRight": "16px", "color": "#64748B", "fontSize": "12px"}),
                    html.Span(f"总耗时: {trace.get('total_response_time_ms', 0):.1f} ms", style={"marginRight": "16px", "color": "#64748B", "fontSize": "12px"}),
                    html.Span("状态: ", style={"color": "#64748B", "fontSize": "12px"}),
                    html.Span("错误" if trace.get("has_error") else "正常", style={
                        "color": "#EF4444" if trace.get("has_error") else "#10B981",
                        "fontWeight": "600", "fontSize": "12px",
                    }),
                ], style={"fontSize": "12px", "marginBottom": "16px"}),
            ]),
            html.Div(spans_html, style={
                "backgroundColor": "#F8FAFC",
                "borderRadius": "8px",
                "border": "1px solid #E2E8F0",
            }),
        ])

    def _render_analytics(self):
        return html.Div([
            html.Div([
                html.H3("🔮 流量预测 (Prophet 模型)", style=TITLE_STYLE),
                html.Div("预测未来1小时的流量走势，支持提前预警", style={"color": "#64748B", "fontSize": "12px", "marginBottom": "14px"}),
                dcc.Graph(id="forecast-chart", style={"height": "340px"}),
            ], style=CARD_STYLE),
            html.Div([
                html.H3("🚨 预测预警", style=TITLE_STYLE),
                html.Div(id="forecast-alerts", style={"maxHeight": "280px", "overflowY": "auto"}),
            ], style=CARD_STYLE),
            html.Div([
                html.H3("📊 异常检测分析", style=TITLE_STYLE),
                html.Div("基于 Z-Score 和模式匹配的多维度异常检测", style={"color": "#64748B", "fontSize": "12px", "marginBottom": "14px"}),
                html.Div([
                    html.Div([
                        html.H4("检测维度", style={"fontSize": "13px", "marginBottom": "8px", "color": "#1E293B"}),
                        html.Ul([
                            html.Li("API 错误率异常"),
                            html.Li("API 响应时间异常 (P99)"),
                            html.Li("服务级错误率异常"),
                            html.Li("系统性错误爆发检测"),
                            html.Li("系统性延迟尖峰检测"),
                        ], style={"fontSize": "12px", "color": "#475569", "paddingLeft": "18px", "lineHeight": "1.8"}),
                    ], style={**CARD_STYLE, "flex": "1", "marginRight": "14px", "marginBottom": "0"}),
                    html.Div([
                        html.H4("算法参数", style={"fontSize": "13px", "marginBottom": "8px", "color": "#1E293B"}),
                        html.Ul([
                            html.Li(f"Z-Score 阈值: {config.ANOMALY_ZSCORE_THRESHOLD}σ"),
                            html.Li("严重等级: medium / high / critical"),
                            html.Li("告警抑制: 60秒冷却"),
                            html.Li(f"滑动窗口: {config.SLIDING_WINDOW_SECONDS // 60}分钟"),
                            html.Li("自适应基线: 历史学习"),
                        ], style={"fontSize": "12px", "color": "#475569", "paddingLeft": "18px", "lineHeight": "1.8"}),
                    ], style={**CARD_STYLE, "flex": "1", "marginBottom": "0"}),
                ], style={"display": "flex"}),
            ], style=CARD_STYLE),
        ])

    def _update_forecast(self, n):
        forecast_data = self.forecaster.get_last_forecast()
        alerts = self.forecaster.get_alerts(limit=10)

        fig = self._render_forecast_chart(forecast_data)
        alert_list = self._render_forecast_alerts(alerts)
        return fig, alert_list

    def _render_forecast_chart(self, forecast_data):
        if not forecast_data:
            fig = go.Figure()
            fig.update_layout(
                template="plotly_white",
                title="预测模型初始化中...",
                margin=dict(l=50, r=50, t=40, b=40),
            )
            return fig

        timestamps = forecast_data.get("timestamps", [])
        predicted = forecast_data.get("predicted", [])
        lower = forecast_data.get("lower_bound", [])
        upper = forecast_data.get("upper_bound", [])
        threshold = forecast_data.get("threshold", 0)
        model = forecast_data.get("model", "prophet")

        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=timestamps, y=upper, fill=None, mode="lines",
            line=dict(width=0), showlegend=False,
        ))
        fig.add_trace(go.Scatter(
            x=timestamps, y=lower, fill="tonexty", mode="lines",
            line=dict(width=0), fillcolor="rgba(59, 130, 246, 0.15)",
            name="95%置信区间",
        ))
        fig.add_trace(go.Scatter(
            x=timestamps, y=predicted, mode="lines",
            line=dict(color="#3B82F6", width=2),
            name="预测流量",
        ))
        fig.add_hline(
            y=threshold, line_dash="dash", line_color="#EF4444",
            annotation_text=f"告警阈值: {threshold:,.0f}",
            annotation_position="top right",
        )

        fig.update_layout(
            template="plotly_white",
            hovermode="x unified",
            margin=dict(l=50, r=50, t=10, b=50),
            legend=dict(orientation="h", yanchor="bottom", y=1.02),
            yaxis_title="请求数/30s",
            xaxis=dict(tickangle=45, tickfont=dict(size=9), nticks=8),
            annotations=[
                dict(text=f"模型: {model}", xref="paper", yref="paper",
                     x=0.98, y=0.95, showarrow=False,
                     font=dict(size=10, color="#64748B")),
            ],
        )
        return fig

    def _render_forecast_alerts(self, alerts):
        if not alerts:
            return html.Div([
                html.Div("🔮", style={"fontSize": "42px", "textAlign": "center", "marginBottom": "10px"}),
                html.Div("暂无预测预警", style={"textAlign": "center", "color": "#64748B", "fontSize": "13px"}),
                html.Div("当前预测流量在安全范围内", style={"textAlign": "center", "color": "#10B981", "fontSize": "11px", "marginTop": "4px"}),
            ], style={"padding": "36px 20px"})

        items = []
        for a in reversed(alerts):
            sev_colors = {
                "critical": ("#FEF2F2", "#DC2626"),
                "high": ("#FFF7ED", "#EA580C"),
                "medium": ("#FEF3C7", "#D97706"),
            }
            sev = a.get("severity", "medium")
            bg, color = sev_colors.get(sev, sev_colors["medium"])

            items.append(html.Div([
                html.Div([
                    html.Span(sev.upper(), style={
                        "fontSize": "10px", "fontWeight": "700", "color": color,
                        "backgroundColor": bg, "padding": "3px 8px",
                        "borderRadius": "4px",
                    }),
                    html.Span(str(a.get("timestamp", ""))[-8:], style={
                        "fontSize": "10px", "color": "#94A3B8", "marginLeft": "8px",
                    }),
                ], style={"marginBottom": "5px"}),
                html.Div(a.get("message", ""), style={
                    "fontSize": "12px", "color": "#334155", "lineHeight": "1.4",
                }),
            ], style={
                "padding": "10px",
                "borderLeft": f"3px solid {color}",
                "marginBottom": "8px",
                "backgroundColor": "white",
                "borderRadius": "6px",
            }))

        return html.Div(items)

    def _render_nlp(self):
        return html.Div([
            html.Div([
                html.H3("💬 自然语言查询", style=TITLE_STYLE),
                html.Div("用自然语言描述你想查看的数据，系统自动解析并生成图表", style={
                    "color": "#64748B", "fontSize": "12px", "marginBottom": "14px",
                }),
                html.Div([
                    dcc.Input(
                        id="nlp-input", type="text",
                        placeholder='例如："最慢的三个接口"、"错误率最高的服务"、"调用最多的前10个API"',
                        style={
                            "flex": "1", "padding": "11px 14px",
                            "border": "2px solid #CBD5E1",
                            "borderRadius": "8px", "fontSize": "14px",
                            "marginRight": "10px",
                        },
                    ),
                    html.Button(
                        "🔍 查询", id="nlp-submit", n_clicks=0,
                        style={
                            "padding": "11px 28px",
                            "backgroundColor": "#3B82F6",
                            "color": "white", "border": "none",
                            "borderRadius": "8px",
                            "cursor": "pointer",
                            "fontSize": "14px", "fontWeight": "600",
                        },
                    ),
                ], style={"display": "flex", "marginBottom": "12px"}),
                html.Div([
                    html.Span("💡 示例: ", style={"fontSize": "11px", "color": "#64748B"}),
                    html.Span('"最慢的5个接口"  ', style={"fontSize": "11px", "color": "#3B82F6"}),
                    html.Span('"错误率最高的服务"  ', style={"fontSize": "11px", "color": "#3B82F6"}),
                    html.Span('"调用最多的前10个API"', style={"fontSize": "11px", "color": "#3B82F6"}),
                ]),
            ], style=CARD_STYLE),
            html.Div([
                html.H3("📊 查询结果", style=TITLE_STYLE),
                html.Div(id="nlp-result", style={"marginBottom": "12px"}),
                dcc.Graph(id="nlp-chart", style={"height": "380px"}),
            ], style=CARD_STYLE),
        ])

    def _handle_nlp_query(self, n_clicks, query):
        if not query or not query.strip():
            return (
                html.Div("请输入查询语句", style={"padding": "20px", "color": "#666", "textAlign": "center"}),
                go.Figure(),
            )

        parsed = self.nlp_engine.parse(query)
        agg_data = self.aggregator.get_cached()
        result = self.nlp_engine.execute(
            parsed,
            agg_data.get("api_metrics", {}),
            agg_data.get("service_metrics", {}),
        )

        result_html = self._render_nlp_result(result)
        chart = self._render_nlp_chart(result)
        return result_html, chart

    def _render_nlp_result(self, result):
        if not result or not result.get("results"):
            return html.Div("暂无查询结果", style={"color": "#64748B", "padding": "16px"})

        return html.Div([
            html.Div([
                html.Strong("查询: ", style={"color": "#1E293B", "fontSize": "13px"}),
                html.Span(result.get("query", ""), style={"color": "#475569", "fontSize": "13px"}),
            ], style={"marginBottom": "6px"}),
            html.Div([
                html.Strong("说明: ", style={"color": "#1E293B", "fontSize": "12px"}),
                html.Span(result.get("description", ""), style={"color": "#475569", "fontSize": "12px"}),
            ]),
        ], style={
            "backgroundColor": "#F0F9FF",
            "padding": "12px 16px",
            "borderRadius": "8px",
            "borderLeft": "4px solid #3B82F6",
        })

    def _render_nlp_chart(self, result):
        if not result or not result.get("results"):
            fig = go.Figure()
            fig.update_layout(template="plotly_white", title="暂无数据")
            return fig

        data = result.get("results", [])
        x_key = result.get("x_key", "name")
        y_key = result.get("y_key", "total_requests")
        chart_type = result.get("chart_type", "bar")
        title = result.get("title", "")

        fig = go.Figure()
        if chart_type == "bar":
            fig.add_trace(go.Bar(
                x=[d[x_key] for d in data],
                y=[d.get(y_key, 0) for d in data],
                marker_color="#3B82F6",
                text=[f"{d.get(y_key, 0):.2f}" for d in data],
                textposition="outside",
            ))
        elif chart_type == "pie":
            fig.add_trace(go.Pie(
                labels=[d[x_key] for d in data],
                values=[d.get(y_key, 0) for d in data],
                hole=0.3,
            ))

        fig.update_layout(
            template="plotly_white",
            title=title,
            margin=dict(l=50, r=50, t=50, b=80),
            xaxis=dict(tickangle=45, tickfont=dict(size=10)),
        )
        return fig

    def _render_report(self):
        return html.Div([
            html.Div([
                html.H3("📑 报告导出", style=TITLE_STYLE),
                html.Div("一键导出当前监控数据为 PPT 格式报告", style={
                    "color": "#64748B", "fontSize": "12px", "marginBottom": "20px",
                }),
                html.Div([
                    html.Div([
                        html.H4("📋 报告内容", style={"fontSize": "14px", "marginBottom": "10px"}),
                        html.Ul([
                            html.Li("监控概览 (总览统计卡片)"),
                            html.Li("请求量与响应时间趋势图"),
                            html.Li("API 接口性能排行"),
                            html.Li("服务节点健康状态表"),
                            html.Li("异常检测事件列表"),
                            html.Li("流量预测与预警分析"),
                            html.Li("服务调用依赖概览"),
                        ], style={"fontSize": "12px", "color": "#475569", "paddingLeft": "18px", "lineHeight": "2"}),
                    ], style={**CARD_STYLE, "flex": "1", "marginRight": "14px", "marginBottom": "0"}),
                    html.Div([
                        html.H4("⚙️ 导出设置", style={"fontSize": "14px", "marginBottom": "10px"}),
                        html.Div([
                            html.Label("报告格式:", style={"display": "block", "marginBottom": "6px", "fontSize": "12px"}),
                            dcc.Dropdown(
                                options=[{"label": "PPTX (PowerPoint)", "value": "pptx"}],
                                value="pptx", style={"marginBottom": "14px"},
                            ),
                            html.Label("数据范围:", style={"display": "block", "marginBottom": "6px", "fontSize": "12px"}),
                            dcc.Dropdown(
                                options=[
                                    {"label": "当前滑动窗口 (5分钟)", "value": "window"},
                                    {"label": "最近1小时", "value": "1h"},
                                ],
                                value="window", style={"marginBottom": "20px"},
                            ),
                            html.Button(
                                "📥 导出 PPT 报告",
                                id="export-ppt", n_clicks=0,
                                style={
                                    "width": "100%", "padding": "12px",
                                    "backgroundColor": "#10B981",
                                    "color": "white", "border": "none",
                                    "borderRadius": "8px",
                                    "cursor": "pointer",
                                    "fontSize": "14px", "fontWeight": "600",
                                },
                            ),
                        ]),
                    ], style={**CARD_STYLE, "flex": "1", "marginBottom": "0"}),
                ], style={"display": "flex", "marginBottom": "20px"}),
            ], style=CARD_STYLE),
            html.Div([
                html.H3("📝 使用说明", style=TITLE_STYLE),
                html.Ul([
                    html.Li("点击 导出 PPT 报告 按钮即可下载完整的监控报告"),
                    html.Li("报告包含当前所有监控指标、图表和异常事件"),
                    html.Li("报告格式为 .pptx，可用 Microsoft PowerPoint 或 WPS 打开"),
                ], style={"fontSize": "12px", "color": "#475569", "lineHeight": "2", "paddingLeft": "18px"}),
            ], style=CARD_STYLE),
        ])

    def _export_report(self, n_clicks):
        agg_data = self.aggregator.get_cached()
        anomalies = self.anomaly_detector.get_recent_anomalies(limit=50)
        forecast_data = self.forecaster.get_last_forecast()
        forecast_alerts = self.forecaster.get_alerts(limit=20)
        dep_metrics = self.dep_graph.get_metrics()

        pptx_bytes = self.report_gen.generate_report(
            aggregation_data=agg_data,
            anomalies=anomalies,
            forecast_data=forecast_data,
            forecast_alerts=forecast_alerts,
            dependency_metrics=dep_metrics,
        )

        return dcc.send_bytes(
            pptx_bytes,
            f"log_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pptx",
        )

    def _render_settings(self):
        ws_status = "已启用" if self.ws_enabled else "未启用 (轮询模式)"
        ws_color = "#10B981" if self.ws_enabled else "#F59E0B"

        return html.Div([
            html.Div([
                html.H3("⚙️ 系统设置", style=TITLE_STYLE),
                html.Div([
                    html.Div([
                        html.Label("告警阈值设置", style={"fontSize": "14px", "fontWeight": "600", "marginBottom": "14px", "display": "block"}),
                        html.Div([
                            html.Label("流量告警阈值 (请求数/30s):", style={"display": "block", "marginBottom": "5px", "fontSize": "12px"}),
                            dcc.Input(type="number", value=config.TRAFFIC_ALERT_THRESHOLD,
                                style={"width": "100%", "padding": "7px 10px", "border": "1px solid #CBD5E1", "borderRadius": "6px", "fontSize": "13px"}),
                        ], style={"marginBottom": "14px"}),
                        html.Div([
                            html.Label("异常检测 Z-Score 阈值:", style={"display": "block", "marginBottom": "5px", "fontSize": "12px"}),
                            dcc.Input(type="number", value=config.ANOMALY_ZSCORE_THRESHOLD, step=0.5,
                                style={"width": "100%", "padding": "7px 10px", "border": "1px solid #CBD5E1", "borderRadius": "6px", "fontSize": "13px"}),
                        ], style={"marginBottom": "14px"}),
                        html.Div([
                            html.Label("滑动窗口大小 (秒):", style={"display": "block", "marginBottom": "5px", "fontSize": "12px"}),
                            dcc.Input(type="number", value=config.SLIDING_WINDOW_SECONDS,
                                style={"width": "100%", "padding": "7px 10px", "border": "1px solid #CBD5E1", "borderRadius": "6px", "fontSize": "13px"}),
                        ]),
                    ], style={**CARD_STYLE, "flex": "1", "marginRight": "14px", "marginBottom": "0"}),
                    html.Div([
                        html.Label("Kafka 配置", style={"fontSize": "14px", "fontWeight": "600", "marginBottom": "14px", "display": "block"}),
                        html.Div([
                            html.Label("Bootstrap Servers:", style={"display": "block", "marginBottom": "5px", "fontSize": "12px"}),
                            dcc.Input(type="text", value=config.KAFKA_BOOTSTRAP_SERVERS,
                                style={"width": "100%", "padding": "7px 10px", "border": "1px solid #CBD5E1", "borderRadius": "6px", "fontSize": "13px"}),
                        ], style={"marginBottom": "14px"}),
                        html.Div([
                            html.Label("Topic:", style={"display": "block", "marginBottom": "5px", "fontSize": "12px"}),
                            dcc.Input(type="text", value=config.KAFKA_TOPIC,
                                style={"width": "100%", "padding": "7px 10px", "border": "1px solid #CBD5E1", "borderRadius": "6px", "fontSize": "13px"}),
                        ], style={"marginBottom": "14px"}),
                        html.Div([
                            html.Label("WebSocket 推送间隔 (秒):", style={"display": "block", "marginBottom": "5px", "fontSize": "12px"}),
                            dcc.Input(type="number", value=config.WEBSOCKET_PUSH_INTERVAL, step=0.5,
                                style={"width": "100%", "padding": "7px 10px", "border": "1px solid #CBD5E1", "borderRadius": "6px", "fontSize": "13px"}),
                        ]),
                    ], style={**CARD_STYLE, "flex": "1", "marginBottom": "0"}),
                ], style={"display": "flex", "marginBottom": "20px"}),
            ], style=CARD_STYLE),
            html.Div([
                html.H3("ℹ️ 系统信息", style=TITLE_STYLE),
                html.Div([
                    html.Div([html.Strong(k + ": "), html.Span(v, style={"color": "#64748B"})],
                             style={"marginBottom": "6px"})
                    for k, v in [
                        ("数据流处理引擎", "Pandas + Dask 混合模式"),
                        ("时序预测模型", "Prophet (带降级模式)"),
                        ("异常检测算法", "Z-Score + 模式匹配"),
                        ("实时推送", ws_status),
                        ("模拟日志速率", f"{config.SIMULATION_LOGS_PER_SEC:,} 条/秒"),
                        ("Dask Worker 数", str(config.DASK_WORKERS)),
                    ]
                ], style={"fontSize": "12px", "lineHeight": "1.8", "color": "#1E293B"}),
            ], style=CARD_STYLE),
        ])

    def _consume_loop(self):
        print("[INFO] Consume loop started")
        batch_size = config.SIMULATION_BATCH_SIZE
        while self._running:
            try:
                logs = self.consumer.consume_batch(max_items=batch_size)
                if logs:
                    self.aggregator.ingest(logs)
                    self.dep_graph.ingest(logs)
                time.sleep(0.05)
            except Exception as e:
                print(f"[ERROR] Consume loop: {e}")
                time.sleep(0.1)

    def _aggregate_loop(self):
        print("[INFO] Aggregate loop started")
        while self._running:
            try:
                agg_data = self.aggregator.aggregate()

                ts = agg_data.get("timeseries", {})
                if ts.get("timestamps"):
                    self.forecaster.ingest_data(
                        ts.get("timestamps", []),
                        ts.get("request_counts", []),
                    )

                anomalies = self.anomaly_detector.update_and_detect(
                    agg_data.get("api_metrics", {}),
                    agg_data.get("service_metrics", {}),
                )
                for a in anomalies:
                    self.ws_manager.push_anomaly(a)

                time.sleep(1)
            except Exception as e:
                print(f"[ERROR] Aggregate loop: {e}")
                time.sleep(1)

    def _forecast_loop(self):
        print("[INFO] Forecast loop started")
        while self._running:
            try:
                result = self.forecaster.forecast()
                time.sleep(30)
            except Exception as e:
                print(f"[ERROR] Forecast loop: {e}")
                time.sleep(5)

    def _get_ws_data(self):
        agg_data = self.aggregator.get_cached()
        anomalies = self.anomaly_detector.get_recent_anomalies(limit=20)
        dep_graph = self.dep_graph.get_cytoscape_graph()

        return {
            "aggregation": agg_data,
            "anomalies": anomalies,
            "dependency_graph": dep_graph,
            "dependency_metrics": self.dep_graph.get_metrics(),
        }

    def start(self, host="0.0.0.0", port=8050):
        self._running = True
        self.consumer.start()

        self._consume_thread = threading.Thread(target=self._consume_loop, daemon=True)
        self._consume_thread.start()

        self._aggregate_thread = threading.Thread(target=self._aggregate_loop, daemon=True)
        self._aggregate_thread.start()

        self._forecast_thread = threading.Thread(target=self._forecast_loop, daemon=True)
        self._forecast_thread.start()

        if self.ws_enabled:
            self.ws_manager.set_data_provider(self._get_ws_data)
            self.ws_manager.start_push_loop()

        print(f"[INFO] Dashboard starting on http://{host}:{port}")
        print(f"[INFO] WebSocket enabled: {self.ws_enabled}")
        print(f"[INFO] Simulation rate: {config.SIMULATION_LOGS_PER_SEC:,} logs/sec")

        self.ws_manager.run(
            self.server,
            host=host,
            port=port,
            debug=False,
        )

    def stop(self):
        self._running = False
        self.consumer.stop()
        self.ws_manager.stop_push_loop()


def main():
    dashboard = LogDashboard()
    try:
        dashboard.start()
    except KeyboardInterrupt:
        dashboard.stop()


if __name__ == "__main__":
    main()
