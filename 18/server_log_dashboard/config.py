import os

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC", "server-logs")
KAFKA_GROUP_ID = os.getenv("KAFKA_GROUP_ID", "log-dashboard")

CLICKHOUSE_HOST = os.getenv("CLICKHOUSE_HOST", "localhost")
CLICKHOUSE_PORT = int(os.getenv("CLICKHOUSE_PORT", "8123"))
CLICKHOUSE_DB = os.getenv("CLICKHOUSE_DB", "log_analytics")

SLIDING_WINDOW_SECONDS = 300

FORECAST_HORIZON_HOURS = 1
FORECAST_RETRAIN_INTERVAL = 300
TRAFFIC_ALERT_THRESHOLD = float(os.getenv("TRAFFIC_ALERT_THRESHOLD", "50000"))

ANOMALY_ZSCORE_THRESHOLD = 3.0
ANOMALY_IQR_MULTIPLIER = 1.5

WEBSOCKET_PUSH_INTERVAL = 1.0

SIMULATION_LOGS_PER_SEC = 50000
SIMULATION_BATCH_SIZE = 5000

DASK_WORKERS = int(os.getenv("DASK_WORKERS", "4"))

SERVICES = [
    "gateway", "auth-service", "user-service", "order-service",
    "payment-service", "inventory-service", "notification-service",
    "search-service", "analytics-service", "config-service",
]

API_ENDPOINTS = [
    "/api/v1/login", "/api/v1/register", "/api/v1/users",
    "/api/v1/orders", "/api/v1/orders/{id}", "/api/v1/payments",
    "/api/v1/inventory", "/api/v1/search", "/api/v1/notifications",
    "/api/v1/config", "/api/v1/health", "/api/v1/analytics",
    "/api/v1/reports", "/api/v1/export",
]

HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"]

SERVICE_DEPENDENCIES = {
    "gateway": ["auth-service", "user-service", "order-service", "search-service"],
    "auth-service": ["user-service", "config-service"],
    "order-service": ["payment-service", "inventory-service", "notification-service", "user-service"],
    "payment-service": ["notification-service", "analytics-service"],
    "search-service": ["inventory-service", "analytics-service"],
    "user-service": ["notification-service", "config-service"],
    "inventory-service": ["notification-service", "analytics-service"],
    "notification-service": [],
    "analytics-service": ["config-service"],
    "config-service": [],
}
