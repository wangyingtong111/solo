import { useEffect, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { ServerMessage, ClientMessage } from '@shared/types';

const WS_URL = 'ws://localhost:3001/ws';

let wsInstance: WebSocket | null = null;
let wsState = {
  connected: false,
  reconnectTimer: null as NodeJS.Timeout | null,
  listeners: new Set<(msg: ServerMessage) => void>(),
  initialized: false,
};

function connect() {
  if (wsInstance && wsInstance.readyState === WebSocket.OPEN) {
    return;
  }

  try {
    const ws = new WebSocket(WS_URL);
    wsInstance = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      wsState.connected = true;
      useAppStore.getState().setWsConnected(true);

      const subscribeMsg: ClientMessage = {
        type: 'subscribe',
        sensorIds: Array.from({ length: 10 }, (_, i) => i + 1),
      };
      ws.send(JSON.stringify(subscribeMsg));
    };

    ws.onmessage = (event) => {
      try {
        const data: ServerMessage = JSON.parse(event.data);
        for (const listener of wsState.listeners) {
          listener(data);
        }
      } catch (e) {
        console.error('Failed to parse WS message:', e);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      wsState.connected = false;
      useAppStore.getState().setWsConnected(false);
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  } catch (e) {
    console.error('Failed to connect WebSocket:', e);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (wsState.reconnectTimer) {
    clearTimeout(wsState.reconnectTimer);
  }
  wsState.reconnectTimer = setTimeout(() => {
    connect();
  }, 2000);
}

function addListener(listener: (msg: ServerMessage) => void) {
  wsState.listeners.add(listener);
}

function removeListener(listener: (msg: ServerMessage) => void) {
  wsState.listeners.delete(listener);
}

export function useWebSocket() {
  const { updateWaveform, updateFeatures, addAlert, updatePrediction } = useAppStore();

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'waveform':
        updateWaveform(msg.sensorId, msg.samples);
        break;
      case 'features':
        updateFeatures(msg);
        break;
      case 'alert':
        addAlert(msg);
        break;
      case 'prediction':
        updatePrediction(msg as any);
        break;
    }
  }, [updateWaveform, updateFeatures, addAlert, updatePrediction]);

  useEffect(() => {
    if (!wsState.initialized) {
      wsState.initialized = true;
      connect();
    }

    addListener(handleMessage);

    return () => {
      removeListener(handleMessage);
    };
  }, [handleMessage]);

  const sendMessage = useCallback((msg: ClientMessage) => {
    if (wsInstance && wsInstance.readyState === WebSocket.OPEN) {
      wsInstance.send(JSON.stringify(msg));
    }
  }, []);

  const updateThreshold = useCallback((threshold: number) => {
    sendMessage({ type: 'config', kurtosisThreshold: threshold });
  }, [sendMessage]);

  return { sendMessage, updateThreshold };
}
