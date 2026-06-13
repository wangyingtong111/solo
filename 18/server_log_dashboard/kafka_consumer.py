import json
import random
import time
import uuid
import threading
from datetime import datetime, timedelta
from collections import deque
from dataclasses import dataclass, asdict
from typing import Optional, Callable

import config


@dataclass
class LogEntry:
    timestamp: str
    request_id: str
    trace_id: str
    span_id: str
    parent_span_id: Optional[str]
    source_service: str
    target_service: Optional[str]
    method: str
    endpoint: str
    status_code: int
    response_time_ms: float
    error_message: Optional[str]
    client_ip: str
    user_id: Optional[str]


_ERROR_MESSAGES = [
    "Connection refused", "Timeout after 30s", "Internal Server Error",
    "Database connection pool exhausted", "Rate limit exceeded",
    "Circuit breaker open", "Service unavailable", "Memory limit exceeded",
    "Disk I/O error", "SSL handshake failed", None, None, None, None, None,
]

_STATUS_CODES = [200, 200, 200, 200, 200, 200, 200, 201, 204, 301, 400, 401, 403, 404, 500, 502, 503]


class LogGenerator:
    def __init__(self):
        self._rng = random.Random(42)
        self._user_ids = [f"user_{i:05d}" for i in range(1000)]
        self._client_ips = [f"10.{self._rng.randint(0,255)}.{self._rng.randint(0,255)}.{self._rng.randint(0,255)}" for _ in range(200)]
        self._trace_counter = 0
        self._base_traffic = 1000
        self._spike_active = False
        self._spike_end_time = None

    def _get_traffic_multiplier(self, now: datetime) -> float:
        hour = now.hour
        if 9 <= hour <= 12:
            base = 3.0
        elif 14 <= hour <= 17:
            base = 2.5
        elif 0 <= hour <= 6:
            base = 0.3
        else:
            base = 1.0

        if self._spike_active and now < self._spike_end_time:
            base *= 5.0
        elif self._spike_active and now >= self._spike_end_time:
            self._spike_active = False

        if not self._spike_active and self._rng.random() < 0.001:
            self._spike_active = True
            self._spike_end_time = now + timedelta(minutes=self._rng.randint(1, 10))

        return base

    def generate_batch(self, batch_size: int, now: Optional[datetime] = None) -> list:
        if now is None:
            now = datetime.now()

        multiplier = self._get_traffic_multiplier(now)
        entries = []
        trace_id = f"trace_{self._trace_counter:010d}"
        self._trace_counter += 1
        root_span_id = f"span_{uuid.uuid4().hex[:12]}"

        services = config.SERVICES
        endpoints = config.API_ENDPOINTS
        methods = config.HTTP_METHODS

        for _ in range(batch_size):
            source = self._rng.choice(services)
            deps = config.SERVICE_DEPENDENCIES.get(source, [])
            target = self._rng.choice(deps) if deps and self._rng.random() < 0.6 else None

            status = self._rng.choice(_STATUS_CODES)
            is_error = status >= 400
            err_msg = self._rng.choice(_ERROR_MESSAGES) if is_error else None

            if is_error:
                rt = self._rng.lognormvariate(4.5, 1.2)
            else:
                rt = self._rng.lognormvariate(2.0, 0.8)

            ts = now - timedelta(milliseconds=self._rng.randint(0, 1000))
            parent_span = root_span_id if target else None

            entry = LogEntry(
                timestamp=ts.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3],
                request_id=f"req_{uuid.uuid4().hex[:16]}",
                trace_id=trace_id,
                span_id=f"span_{uuid.uuid4().hex[:12]}",
                parent_span_id=parent_span,
                source_service=source,
                target_service=target,
                method=self._rng.choice(methods),
                endpoint=self._rng.choice(endpoints),
                status_code=status,
                response_time_ms=round(rt, 2),
                error_message=err_msg,
                client_ip=self._rng.choice(self._client_ips),
                user_id=self._rng.choice(self._user_ids) if self._rng.random() < 0.8 else None,
            )
            entries.append(asdict(entry))

        return entries


class KafkaSimulator:
    def __init__(self, logs_per_sec: int = config.SIMULATION_LOGS_PER_SEC):
        self.logs_per_sec = logs_per_sec
        self.generator = LogGenerator()
        self._buffer = deque(maxlen=500000)
        self._running = False
        self._thread = None
        self._lock = threading.Lock()
        self._callbacks = []

    def register_callback(self, callback: Callable):
        self._callbacks.append(callback)

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._produce_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)

    def _produce_loop(self):
        batch_interval = 0.1
        batch_size = max(1, self.logs_per_sec // 10)

        while self._running:
            now = datetime.now()
            batch = self.generator.generate_batch(batch_size, now)

            with self._lock:
                self._buffer.extend(batch)

            for cb in self._callbacks:
                try:
                    cb(batch)
                except Exception:
                    pass

            time.sleep(batch_interval)

    def consume_batch(self, max_items: int = 5000) -> list:
        with self._lock:
            items = []
            for _ in range(min(max_items, len(self._buffer))):
                if self._buffer:
                    items.append(self._buffer.popleft())
            return items

    def peek_latest(self, max_items: int = 100) -> list:
        with self._lock:
            return list(self._buffer)[-max_items:]


class KafkaConsumerAdapter:
    def __init__(self, use_real_kafka: bool = False):
        self.use_real_kafka = use_real_kafka
        self._consumer = None
        self._simulator = None

        if use_real_kafka:
            try:
                from confluent_kafka import Consumer
                self._consumer = Consumer({
                    "bootstrap.servers": config.KAFKA_BOOTSTRAP_SERVERS,
                    "group.id": config.KAFKA_GROUP_ID,
                    "auto.offset.reset": "latest",
                    "enable.auto.commit": True,
                })
                self._consumer.subscribe([config.KAFKA_TOPIC])
            except Exception as e:
                print(f"Kafka connection failed, falling back to simulator: {e}")
                self.use_real_kafka = False

        if not self.use_real_kafka:
            self._simulator = KafkaSimulator()

    def start(self):
        if self._simulator:
            self._simulator.start()

    def stop(self):
        if self._simulator:
            self._simulator.stop()
        if self._consumer:
            self._consumer.close()

    def consume_batch(self, max_items: int = 5000) -> list:
        if self.use_real_kafka and self._consumer:
            messages = []
            for _ in range(max_items):
                msg = self._consumer.poll(timeout=0.01)
                if msg is None:
                    break
                if msg.error():
                    continue
                try:
                    data = json.loads(msg.value().decode("utf-8"))
                    messages.append(data)
                except Exception:
                    continue
            return messages
        else:
            if self._simulator:
                return self._simulator.consume_batch(max_items)
            return []

    def register_callback(self, callback: Callable):
        if self._simulator:
            self._simulator.register_callback(callback)
