import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import { initSensorStates, generateWaveform, SENSORS, getSensorKurtosis } from './sensorSimulator';
import { extractFeatures } from '../utils/signalProcessing';
import { checkAlert, setKurtosisThreshold, getKurtosisThreshold, getRecentAlerts } from './alertService';
import { initPredictionStates, updatePrediction, getPrediction } from './predictionModel';
import type { ClientMessage, ServerMessage, FeatureData, AlertData } from '../../shared/types';

const SAMPLE_RATE = 5000;
const FRAME_SIZE = 500;
const FRAME_INTERVAL = 100;

interface ClientSession {
  ws: WebSocket;
  subscribedSensors: Set<number>;
}

const clients = new Set<ClientSession>();
let wss: WebSocketServer | null = null;
let frameTimer: NodeJS.Timeout | null = null;
let featureTimer: NodeJS.Timeout | null = null;
let predictionTimer: NodeJS.Timeout | null = null;

export function initWebSocketServer(server: HttpServer) {
  wss = new WebSocketServer({ server, path: '/ws' });

  initSensorStates();
  initPredictionStates();

  wss.on('connection', (ws) => {
    const session: ClientSession = {
      ws,
      subscribedSensors: new Set(),
    };
    clients.add(session);

    ws.on('message', (data) => {
      try {
        const message: ClientMessage = JSON.parse(data.toString());
        handleClientMessage(session, message);
      } catch (e) {
        console.error('Failed to parse client message:', e);
      }
    });

    ws.on('close', () => {
      clients.delete(session);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      clients.delete(session);
    });
  });

  startDataStream();
  startFeatureStream();
  startPredictionStream();

  console.log('WebSocket server initialized');
}

function handleClientMessage(session: ClientMessage, message: ClientMessage) {
  switch (message.type) {
    case 'subscribe':
      if (message.sensorIds) {
        for (const id of message.sensorIds) {
          (session as unknown as ClientSession).subscribedSensors.add(id);
        }
      }
      break;
    case 'unsubscribe':
      if (message.sensorIds) {
        for (const id of message.sensorIds) {
          (session as unknown as ClientSession).subscribedSensors.delete(id);
        }
      }
      break;
    case 'config':
      if (message.kurtosisThreshold !== undefined) {
        setKurtosisThreshold(message.kurtosisThreshold);
      }
      break;
  }
}

function startDataStream() {
  frameTimer = setInterval(() => {
    const timestamp = Date.now();

    for (const sensor of SENSORS) {
      const samples = generateWaveform(sensor.id, FRAME_SIZE, SAMPLE_RATE);

      const message: ServerMessage = {
        type: 'waveform',
        timestamp,
        sensorId: sensor.id,
        samples,
      };

      broadcastToSubscribers(sensor.id, message);
    }
  }, FRAME_INTERVAL);
}

function startFeatureStream() {
  let frameBuffer = new Map<number, number[]>();

  featureTimer = setInterval(() => {
    const timestamp = Date.now();

    for (const sensor of SENSORS) {
      const samples = generateWaveform(sensor.id, 1024, SAMPLE_RATE);
      
      let buffered = frameBuffer.get(sensor.id) || [];
      buffered = [...buffered, ...samples].slice(-2048);
      frameBuffer.set(sensor.id, buffered);

      if (buffered.length >= 1024) {
        const features = extractFeatures(buffered.slice(-1024), SAMPLE_RATE);

        const featureMsg: FeatureData = {
          type: 'features',
          timestamp,
          sensorId: sensor.id,
          kurtosis: features.kurtosis,
          peak: features.peak,
          rms: features.rms,
          crestFactor: features.crestFactor,
          spectrum: features.spectrum,
        };

        broadcastToSubscribers(sensor.id, featureMsg);

        const alert = checkAlert(sensor.id, features.kurtosis);
        if (alert) {
          broadcastAll(alert);
        }
      }
    }
  }, 200);
}

function startPredictionStream() {
  predictionTimer = setInterval(() => {
    for (const sensor of SENSORS) {
      const kurtosis = getSensorKurtosis(sensor.id);
      const prediction = updatePrediction(sensor.id, kurtosis, 0.05);

      if (prediction) {
        const msg: ServerMessage = {
          type: 'prediction',
          sensorId: sensor.id,
          ...prediction,
        } as ServerMessage;

        broadcastToSubscribers(sensor.id, msg);
      }
    }
  }, 1000);
}

function broadcastToSubscribers(sensorId: number, message: ServerMessage) {
  const data = JSON.stringify(message);

  for (const client of clients) {
    if (client.subscribedSensors.has(sensorId) && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(data);
      } catch (e) {
        // ignore
      }
    }
  }
}

function broadcastAll(message: ServerMessage) {
  const data = JSON.stringify(message);

  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(data);
      } catch (e) {
        // ignore
      }
    }
  }
}

export function getWebSocketServer(): WebSocketServer | null {
  return wss;
}

export function getAlerts() {
  return getRecentAlerts();
}

export function getThreshold() {
  return getKurtosisThreshold();
}
