import type { AlertData } from '../../shared/types';

const alerts: AlertData[] = [];
const alertCooldowns = new Map<number, number>();
const ALERT_COOLDOWN_MS = 5000;

let kurtosisThreshold = 3.5;

export function setKurtosisThreshold(threshold: number) {
  kurtosisThreshold = threshold;
}

export function getKurtosisThreshold(): number {
  return kurtosisThreshold;
}

export function checkAlert(sensorId: number, kurtosis: number): AlertData | null {
  const now = Date.now();
  const lastAlert = alertCooldowns.get(sensorId) || 0;

  if (now - lastAlert < ALERT_COOLDOWN_MS) {
    return null;
  }

  if (kurtosis > kurtosisThreshold) {
    alertCooldowns.set(sensorId, now);

    const level = kurtosis > kurtosisThreshold * 1.3 ? 'critical' : 'warning';

    const alert: AlertData = {
      type: 'alert',
      id: `alert_${now}_${sensorId}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: now,
      sensorId,
      level,
      kurtosis,
      threshold: kurtosisThreshold,
      message: level === 'critical'
        ? `传感器 ${sensorId} 峭度严重超标！当前值: ${kurtosis.toFixed(2)}`
        : `传感器 ${sensorId} 峭度超过预警阈值，当前值: ${kurtosis.toFixed(2)}`,
    };

    alerts.unshift(alert);
    if (alerts.length > 100) {
      alerts.pop();
    }

    return alert;
  }

  return null;
}

export function getRecentAlerts(limit: number = 50): AlertData[] {
  return alerts.slice(0, limit);
}
