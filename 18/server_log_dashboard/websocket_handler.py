import json
import threading
import time
from datetime import datetime
from typing import Dict, List, Optional, Callable, Set

try:
    from flask_socketio import SocketIO, emit, disconnect
    SOCKETIO_AVAILABLE = True
except ImportError:
    SOCKETIO_AVAILABLE = False

import config


class WebSocketManager:
    def __init__(self, server=None, cors_allowed_origins: str = "*"):
        self.socketio = None
        self._server = server
        self._clients: Set = set()
        self._lock = threading.Lock()
        self._push_thread = None
        self._running = False
        self._push_interval = config.WEBSOCKET_PUSH_INTERVAL
        self._data_provider: Optional[Callable] = None
        self._cors_allowed_origins = cors_allowed_origins
        self._last_push_data: Dict = {}
        self._client_count = 0

    def init_app(self, app) -> bool:
        if not SOCKETIO_AVAILABLE:
            print("flask_socketio not available, WebSocket disabled")
            return False

        try:
            self.socketio = SocketIO(
                app,
                cors_allowed_origins=self._cors_allowed_origins,
                async_mode="threading",
                ping_timeout=60,
                ping_interval=25,
            )
            self._register_handlers()
            return True
        except Exception as e:
            print(f"WebSocket init failed: {e}")
            return False

    def _register_handlers(self):
        @self.socketio.on("connect")
        def handle_connect():
            with self._lock:
                sid = None
                try:
                    import flask
                    sid = flask.request.sid
                except Exception:
                    sid = id(threading.current_thread())

                self._clients.add(sid)
                self._client_count = len(self._clients)
                print(f"Client connected: {sid}, total: {self._client_count}")
                emit("connected", {
                    "status": "ok",
                    "server_time": datetime.now().isoformat(),
                    "client_count": self._client_count,
                })

                if self._last_push_data:
                    emit("realtime_data", self._last_push_data)

        @self.socketio.on("disconnect")
        def handle_disconnect():
            with self._lock:
                sid = None
                try:
                    import flask
                    sid = flask.request.sid
                except Exception:
                    sid = id(threading.current_thread())

                self._clients.discard(sid)
                self._client_count = len(self._clients)
                print(f"Client disconnected: {sid}, remaining: {self._client_count}")

        @self.socketio.on("ping")
        def handle_ping(data=None):
            emit("pong", {
                "server_time": datetime.now().isoformat(),
                "client_count": self._client_count,
            })

        @self.socketio.on("subscribe")
        def handle_subscribe(data):
            channels = data.get("channels", []) if data else []
            emit("subscribed", {"channels": channels, "status": "ok"})

    def set_data_provider(self, provider: Callable[[], Dict]):
        self._data_provider = provider

    def start_push_loop(self, data_provider: Optional[Callable] = None):
        if data_provider:
            self.set_data_provider(data_provider)

        self._running = True
        self._push_thread = threading.Thread(target=self._push_loop, daemon=True)
        self._push_thread.start()

    def stop_push_loop(self):
        self._running = False
        if self._push_thread:
            self._push_thread.join(timeout=5)

    def _push_loop(self):
        print("WebSocket push loop started")
        push_count = 0
        while self._running:
            try:
                start = time.time()

                data = {}
                if self._data_provider:
                    try:
                        data = self._data_provider()
                    except Exception as e:
                        data = {"error": str(e)}

                data["_push_id"] = push_count
                data["_timestamp"] = datetime.now().isoformat()
                data["_client_count"] = self._client_count

                self._last_push_data = data

                if self._client_count > 0 and self.socketio:
                    try:
                        self.socketio.emit("realtime_data", data)
                    except Exception as e:
                        pass

                if self._client_count > 0:
                    push_count += 1

                elapsed = time.time() - start
                sleep_time = max(0.01, self._push_interval - elapsed)
                time.sleep(sleep_time)

            except Exception as e:
                print(f"WebSocket push error: {e}")
                time.sleep(1)

    def push_event(self, event_name: str, data: Dict):
        if self.socketio and self._client_count > 0:
            try:
                self.socketio.emit(event_name, {
                    **data,
                    "_timestamp": datetime.now().isoformat(),
                })
            except Exception as e:
                print(f"Push event error: {e}")

    def push_anomaly(self, anomaly_event: Dict):
        self.push_event("anomaly_alert", {"anomaly": anomaly_event})

    def push_forecast_alert(self, alert: Dict):
        self.push_event("forecast_alert", {"alert": alert})

    def get_client_count(self) -> int:
        return self._client_count

    def run(self, app, host: str = "0.0.0.0", port: int = 8050, debug: bool = False, **kwargs):
        if self.socketio:
            self.socketio.run(app, host=host, port=port, debug=debug, allow_unsafe_werkzeug=True, **kwargs)
        else:
            app.run(host=host, port=port, debug=debug, **kwargs)
