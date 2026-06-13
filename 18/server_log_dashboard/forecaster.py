import threading
import time
from datetime import datetime, timedelta
from collections import deque
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass

import numpy as np
import pandas as pd

import config


@dataclass
class ForecastAlert:
    id: str
    timestamp: str
    metric: str
    forecast_time: str
    predicted_value: float
    threshold: float
    severity: str
    message: str


class ProphetForecaster:
    def __init__(
        self,
        horizon_hours: int = config.FORECAST_HORIZON_HOURS,
        threshold: float = config.TRAFFIC_ALERT_THRESHOLD,
        retrain_interval: int = config.FORECAST_RETRAIN_INTERVAL,
    ):
        self.horizon_hours = horizon_hours
        self.threshold = threshold
        self.retrain_interval = retrain_interval
        self._lock = threading.Lock()
        self._history: deque = deque(maxlen=1440)
        self._model = None
        self._last_train_time = 0
        self._last_forecast: Optional[Dict] = None
        self._alerts: List[ForecastAlert] = deque(maxlen=100)
        self._suppressed: Dict[str, float] = {}
        self._fallback_mode = False

    def ingest_data(self, timestamps: List[str], values: List[int]):
        with self._lock:
            for ts_str, val in zip(timestamps, values):
                try:
                    ts = pd.to_datetime(ts_str)
                    self._history.append((ts, val))
                except Exception:
                    pass

    def _train_model(self) -> bool:
        try:
            from prophet import Prophet
        except ImportError:
            self._fallback_mode = True
            return False

        if len(self._history) < 30:
            return False

        try:
            data = pd.DataFrame(list(self._history), columns=["ds", "y"])
            data = data.groupby("ds")["y"].sum().reset_index()
            data = data.set_index("ds").resample("30s").sum().reset_index()

            self._model = Prophet(
                yearly_seasonality=False,
                weekly_seasonality=False,
                daily_seasonality=True,
                changepoint_prior_scale=0.05,
                interval_width=0.95,
            )
            self._model.fit(data)
            self._fallback_mode = False
            return True
        except Exception as e:
            print(f"Prophet training failed, using fallback: {e}")
            self._fallback_mode = True
            return False

    def forecast(self) -> Optional[Dict]:
        now = time.time()
        should_retrain = now - self._last_train_time > self.retrain_interval

        with self._lock:
            if len(self._history) < 10:
                return None

            if should_retrain:
                self._train_model()
                self._last_train_time = now

            if self._fallback_mode or self._model is None:
                return self._fallback_forecast()

            try:
                future = self._model.make_future_dataframe(
                    periods=self.horizon_hours * 120,
                    freq="30s",
                    include_history=False,
                )
                forecast_df = self._model.predict(future)

                timestamps = forecast_df["ds"].dt.strftime("%Y-%m-%d %H:%M:%S").tolist()
                predicted = forecast_df["yhat"].round(2).tolist()
                lower = forecast_df["yhat_lower"].round(2).tolist()
                upper = forecast_df["yhat_upper"].round(2).tolist()

                result = {
                    "timestamps": timestamps,
                    "predicted": predicted,
                    "lower_bound": lower,
                    "upper_bound": upper,
                    "threshold": self.threshold,
                    "model": "prophet",
                    "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                }

                self._last_forecast = result
                self._check_alerts(result)
                return result

            except Exception as e:
                print(f"Prophet forecast failed: {e}")
                self._fallback_mode = True
                return self._fallback_forecast()

    def _fallback_forecast(self) -> Dict:
        if len(self._history) < 5:
            return None

        data = list(self._history)
        recent_values = [v for _, v in data[-30:]]
        avg = np.mean(recent_values)
        std = np.std(recent_values) if len(recent_values) > 1 else 0
        trend = np.polyfit(range(len(recent_values)), recent_values, 1)[0]

        base_time = data[-1][0] if data else datetime.now()
        timestamps = []
        predicted = []
        lower = []
        upper = []

        for i in range(self.horizon_hours * 120):
            t = base_time + timedelta(seconds=i * 30)
            pred = max(0, avg + trend * i * 0.1 + np.sin(i / 20) * std * 0.3)
            timestamps.append(t.strftime("%Y-%m-%d %H:%M:%S"))
            predicted.append(round(pred, 2))
            lower.append(round(max(0, pred - 2 * std), 2))
            upper.append(round(pred + 2 * std, 2))

        result = {
            "timestamps": timestamps,
            "predicted": predicted,
            "lower_bound": lower,
            "upper_bound": upper,
            "threshold": self.threshold,
            "model": "fallback_arima",
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }

        self._last_forecast = result
        self._check_alerts(result)
        return result

    def _check_alerts(self, forecast_data: Dict):
        now = time.time()
        predicted = forecast_data["predicted"]
        timestamps = forecast_data["timestamps"]

        for i, (val, ts) in enumerate(zip(predicted, timestamps)):
            if val > self.threshold:
                alert_id = f"forecast_alert_{ts}"
                if self._suppressed.get(alert_id, 0) > now:
                    continue

                minutes_ahead = i * 0.5
                severity = "critical" if val > self.threshold * 1.5 else ("high" if val > self.threshold * 1.2 else "medium")

                alert = ForecastAlert(
                    id=alert_id,
                    timestamp=datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
                    metric="request_count",
                    forecast_time=ts,
                    predicted_value=round(val, 2),
                    threshold=self.threshold,
                    severity=severity,
                    message=f"Traffic spike predicted in {minutes_ahead:.0f} min at {ts}: {val:.0f} req/s (threshold: {self.threshold})",
                )

                self._alerts.append(alert)
                self._suppressed[alert_id] = now + 300
                break

    def get_last_forecast(self) -> Optional[Dict]:
        with self._lock:
            return self._last_forecast

    def get_alerts(self, limit: int = 50) -> List[dict]:
        with self._lock:
            return [
                {
                    "id": a.id,
                    "timestamp": a.timestamp,
                    "metric": a.metric,
                    "forecast_time": a.forecast_time,
                    "predicted_value": a.predicted_value,
                    "threshold": a.threshold,
                    "severity": a.severity,
                    "message": a.message,
                }
                for a in list(self._alerts)[-limit:]
            ]

    def set_threshold(self, threshold: float):
        with self._lock:
            self.threshold = threshold
