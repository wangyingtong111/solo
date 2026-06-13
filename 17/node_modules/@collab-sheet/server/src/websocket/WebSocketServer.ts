import { WebSocketServer as WsWebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { IncomingMessage as HttpIncomingMessage } from 'http';
import type { VectorClock, User } from '../types.js';
import { EventStore } from '../eventStore/EventStore.js';
import { EventType, type Event, type EventPayload } from '../eventStore/types.js';
import {
  MessageType,
  type ClientInfo,
  type PresenceData,
  type WebSocketServerMessage,
  type IncomingMessage,
  type CursorPosition,
  type SelectionRange,
} from './types.js';

interface DocClients {
  [clientId: string]: ClientInfo;
}

interface DocPresence {
  [clientId: string]: PresenceData;
}

export class WebSocketServerManager {
  private wss: WsWebSocketServer;
  private eventStore: EventStore;
  private docClients: Map<string, DocClients> = new Map();
  private docPresence: Map<string, DocPresence> = new Map();
  private clientToDoc: Map<string, string> = new Map();

  constructor(server: { on: (event: string, callback: (...args: unknown[]) => void) => void }, eventStore: EventStore) {
    this.wss = new WsWebSocketServer({ noServer: true });
    this.eventStore = eventStore;
    this.setupUpgradeHandler(server);
    this.setupConnectionHandler();
  }

  private setupUpgradeHandler(server: { on: (event: string, callback: (...args: unknown[]) => void) => void }): void {
    server.on('upgrade', (...args: unknown[]) => {
      const request = args[0] as HttpIncomingMessage;
      const socket = args[1] as Parameters<WsWebSocketServer['handleUpgrade']>[1];
      const head = args[2] as Parameters<WsWebSocketServer['handleUpgrade']>[2];
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });
  }

  private setupConnectionHandler(): void {
    this.wss.on('connection', (ws: WebSocket, request: HttpIncomingMessage) => {
      this.handleConnection(ws, request);
    });
  }

  private handleConnection(ws: WebSocket, request: HttpIncomingMessage): void {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const docId = url.searchParams.get('docId');
    const userId = url.searchParams.get('userId');
    const clientId = url.searchParams.get('clientId') || uuidv4();

    if (!docId || !userId) {
      ws.close(4000, 'Missing docId or userId');
      return;
    }

    ws.on('message', (rawData) => {
      this.handleMessage(ws, clientId, docId, userId, rawData);
    });

    ws.on('close', () => {
      this.handleDisconnect(clientId, docId, userId);
    });

    ws.on('error', () => {
      this.handleDisconnect(clientId, docId, userId);
    });
  }

  private handleMessage(ws: WebSocket, clientId: string, docId: string, userId: string, rawData: unknown): void {
    let message: IncomingMessage;

    try {
      const data = rawData instanceof Buffer ? rawData.toString() : String(rawData);
      message = JSON.parse(data) as IncomingMessage;
    } catch {
      this.sendAck(ws, clientId, docId, undefined, false, 'Invalid JSON');
      return;
    }

    switch (message.type) {
      case MessageType.CONNECTED:
        this.handleConnect(ws, clientId, docId, userId, message);
        break;
      case MessageType.SYNC:
        this.handleSync(ws, clientId, docId, userId, message);
        break;
      case MessageType.CELL_UPDATE:
        this.handleCellUpdate(ws, clientId, docId, userId, message);
        break;
      case MessageType.FORMULA_UPDATE:
        this.handleFormulaUpdate(ws, clientId, docId, userId, message);
        break;
      case MessageType.PRESENCE:
        this.handlePresence(ws, clientId, docId, userId, message);
        break;
      case MessageType.OFFLINE_CHANGES:
        this.handleOfflineChanges(ws, clientId, docId, userId, message);
        break;
      case MessageType.RECONNECT:
        this.handleReconnect(ws, clientId, docId, userId, message);
        break;
      default:
        this.sendAck(ws, clientId, docId, undefined, false, `Unknown message type: ${message.type}`);
    }
  }

  private handleConnect(ws: WebSocket, clientId: string, docId: string, userId: string, message: IncomingMessage): void {
    const vectorClock = message.vectorClock ?? {};
    const user = (message.data as { user?: User })?.user;

    this.registerClient(ws, clientId, docId, userId, vectorClock, user);

    const events = this.getEventsAfterVectorClock(docId, vectorClock);
    const onlineClients = this.getOnlinePresence(docId);

    const connectedMessage: WebSocketServerMessage = {
      type: MessageType.CONNECTED,
      docId,
      clientId,
      timestamp: Date.now(),
      data: {
        clientId,
        vectorClock,
        onlineClients,
        events,
      },
    };

    this.sendToClient(ws, connectedMessage);
    this.broadcastPresenceUpdate(docId, clientId, userId, user);
  }

  private handleSync(ws: WebSocket, clientId: string, docId: string, userId: string, message: IncomingMessage): void {
    const vectorClock = message.vectorClock ?? {};
    this.updateClientVectorClock(clientId, docId, vectorClock);

    const events = this.getEventsAfterVectorClock(docId, vectorClock);

    const syncMessage: WebSocketServerMessage = {
      type: MessageType.SYNC,
      docId,
      clientId,
      vectorClock,
      timestamp: Date.now(),
      data: {
        events,
      },
    };

    this.sendToClient(ws, syncMessage);
  }

  private handleCellUpdate(ws: WebSocket, clientId: string, docId: string, userId: string, message: IncomingMessage): void {
    const data = message.data as { cell: { id: string; sheetId: string; value: string | number | boolean | null; formula?: string | null; style?: Record<string, unknown> } } | undefined;
    const vectorClock = message.vectorClock ?? {};

    if (!data?.cell) {
      this.sendAck(ws, clientId, docId, undefined, false, 'Missing cell data');
      return;
    }

    const newVectorClock = this.incrementVectorClock(vectorClock, clientId);

    const event = this.eventStore.appendEvent(
      docId,
      EventType.CELL_UPDATED,
      {
        sheetId: data.cell.sheetId,
        cellId: data.cell.id,
        value: data.cell.value,
      },
      userId,
      newVectorClock,
      data.cell.id
    );

    this.updateClientVectorClock(clientId, docId, newVectorClock);

    if (data.cell.formula !== undefined) {
      this.eventStore.appendEvent(
        docId,
        EventType.CELL_FORMULA_UPDATED,
        {
          sheetId: data.cell.sheetId,
          cellId: data.cell.id,
          formula: data.cell.formula,
        },
        userId,
        newVectorClock,
        data.cell.id
      );
    }

    if (data.cell.style) {
      this.eventStore.appendEvent(
        docId,
        EventType.CELL_STYLE_UPDATED,
        {
          sheetId: data.cell.sheetId,
          cellId: data.cell.id,
          style: data.cell.style,
        },
        userId,
        newVectorClock,
        data.cell.id
      );
    }

    this.sendAck(ws, clientId, docId, event.id, true, undefined, newVectorClock);

    const broadcastMessage: WebSocketServerMessage = {
      type: MessageType.CELL_UPDATE,
      docId,
      clientId,
      vectorClock: newVectorClock,
      timestamp: Date.now(),
      data: {
        cell: {
          id: data.cell.id,
          sheetId: data.cell.sheetId,
          row: (data.cell as { row?: number }).row ?? 0,
          col: (data.cell as { col?: number }).col ?? 0,
          value: data.cell.value,
          formula: data.cell.formula ?? null,
          metadata: {
            userId,
            updatedAt: Date.now(),
            style: data.cell.style,
          },
        },
        eventId: event.id,
      },
    };

    this.broadcastToDoc(docId, broadcastMessage, clientId);
  }

  private handleFormulaUpdate(ws: WebSocket, clientId: string, docId: string, userId: string, message: IncomingMessage): void {
    const data = message.data as { cellId: string; formula: string | null; sheetId: string } | undefined;
    const vectorClock = message.vectorClock ?? {};

    if (!data?.cellId || !data.sheetId) {
      this.sendAck(ws, clientId, docId, undefined, false, 'Missing cellId or sheetId');
      return;
    }

    const newVectorClock = this.incrementVectorClock(vectorClock, clientId);

    const event = this.eventStore.appendEvent(
      docId,
      EventType.CELL_FORMULA_UPDATED,
      {
        sheetId: data.sheetId,
        cellId: data.cellId,
        formula: data.formula,
      },
      userId,
      newVectorClock,
      data.cellId
    );

    this.updateClientVectorClock(clientId, docId, newVectorClock);
    this.sendAck(ws, clientId, docId, event.id, true, undefined, newVectorClock);

    const broadcastMessage: WebSocketServerMessage = {
      type: MessageType.FORMULA_UPDATE,
      docId,
      clientId,
      vectorClock: newVectorClock,
      timestamp: Date.now(),
      data: {
        cellId: data.cellId,
        formula: data.formula,
        sheetId: data.sheetId,
        eventId: event.id,
      },
    };

    this.broadcastToDoc(docId, broadcastMessage, clientId);
  }

  private handlePresence(ws: WebSocket, clientId: string, docId: string, userId: string, message: IncomingMessage): void {
    const data = message.data as { cursor?: CursorPosition; selection?: SelectionRange; user?: User } | undefined;

    this.updatePresence(docId, clientId, userId, data?.cursor, data?.selection, data?.user);

    const presenceData = this.getPresenceData(docId, clientId);
    if (presenceData) {
      const broadcastMessage: WebSocketServerMessage = {
        type: MessageType.PRESENCE,
        docId,
        clientId,
        timestamp: Date.now(),
        data: presenceData,
      };

      this.broadcastToDoc(docId, broadcastMessage, clientId);
    }

    this.sendAck(ws, clientId, docId, undefined, true);
  }

  private handleOfflineChanges(ws: WebSocket, clientId: string, docId: string, userId: string, message: IncomingMessage): void {
    const data = message.data as { events?: Array<{ eventType: string; payload: EventPayload; vectorClock: VectorClock; cellId?: string }> } | undefined;
    const vectorClock = message.vectorClock ?? {};

    if (!data?.events) {
      this.sendAck(ws, clientId, docId, undefined, false, 'Missing events data');
      return;
    }

    let currentVectorClock = { ...vectorClock };
    const createdEvents: Event[] = [];

    for (const offlineEvent of data.events) {
      currentVectorClock = this.incrementVectorClock(currentVectorClock, clientId);

      const event = this.eventStore.appendEvent(
        docId,
        offlineEvent.eventType as Event['eventType'],
        offlineEvent.payload,
        userId,
        currentVectorClock,
        offlineEvent.cellId
      );

      createdEvents.push(event);
    }

    this.updateClientVectorClock(clientId, docId, currentVectorClock);
    this.sendAck(ws, clientId, docId, undefined, true, undefined, currentVectorClock);

    if (createdEvents.length > 0) {
      const syncMessage: WebSocketServerMessage = {
        type: MessageType.SYNC,
        docId,
        clientId,
        vectorClock: currentVectorClock,
        timestamp: Date.now(),
        data: {
          events: createdEvents,
        },
      };

      this.broadcastToDoc(docId, syncMessage, clientId);
    }
  }

  private handleReconnect(ws: WebSocket, clientId: string, docId: string, userId: string, message: IncomingMessage): void {
    const data = message.data as { lastKnownSequence?: number; offlineEvents?: Array<{ eventType: string; payload: EventPayload; vectorClock: VectorClock; cellId?: string }> } | undefined;
    const vectorClock = message.vectorClock ?? {};
    const user = (message.data as { user?: User })?.user;

    this.registerClient(ws, clientId, docId, userId, vectorClock, user);

    let currentVectorClock = { ...vectorClock };
    const createdEvents: Event[] = [];

    if (data?.offlineEvents && data.offlineEvents.length > 0) {
      for (const offlineEvent of data.offlineEvents) {
        currentVectorClock = this.incrementVectorClock(currentVectorClock, clientId);

        const event = this.eventStore.appendEvent(
          docId,
          offlineEvent.eventType as Event['eventType'],
          offlineEvent.payload,
          userId,
          currentVectorClock,
          offlineEvent.cellId
        );

        createdEvents.push(event);
      }
    }

    const missingEvents = this.getEventsAfterVectorClock(docId, currentVectorClock);
    const allEvents = [...createdEvents, ...missingEvents];
    const onlineClients = this.getOnlinePresence(docId);

    this.updateClientVectorClock(clientId, docId, currentVectorClock);

    const reconnectMessage: WebSocketServerMessage = {
      type: MessageType.RECONNECT,
      docId,
      clientId,
      vectorClock: currentVectorClock,
      timestamp: Date.now(),
      data: {
        lastKnownSequence: data?.lastKnownSequence,
        offlineEvents: data?.offlineEvents ?? [],
      },
    };

    this.sendToClient(ws, reconnectMessage);

    const syncMessage: WebSocketServerMessage = {
      type: MessageType.SYNC,
      docId,
      clientId,
      vectorClock: currentVectorClock,
      timestamp: Date.now(),
      data: {
        events: allEvents,
      },
    };

    this.sendToClient(ws, syncMessage);

    if (allEvents.length > 0) {
      this.broadcastToDoc(docId, syncMessage, clientId);
    }

    this.broadcastPresenceUpdate(docId, clientId, userId, user);

    const presenceBroadcastMessage: WebSocketServerMessage = {
      type: MessageType.PRESENCE,
      docId,
      clientId,
      timestamp: Date.now(),
      data: {
        onlineClients,
      } as unknown as PresenceData,
    };

    this.sendToClient(ws, presenceBroadcastMessage);
  }

  private handleDisconnect(clientId: string, docId: string, userId: string): void {
    this.removeClient(clientId, docId);
    this.broadcastPresenceLeave(docId, clientId, userId);
  }

  private registerClient(ws: WebSocket, clientId: string, docId: string, userId: string, vectorClock: VectorClock, user?: User): void {
    if (!this.docClients.has(docId)) {
      this.docClients.set(docId, {});
    }

    const clients = this.docClients.get(docId)!;
    clients[clientId] = {
      clientId,
      userId,
      docId,
      vectorClock,
      socket: ws,
      user,
    };

    this.clientToDoc.set(clientId, docId);
    this.updatePresence(docId, clientId, userId, undefined, undefined, user);
  }

  private removeClient(clientId: string, docId: string): void {
    const clients = this.docClients.get(docId);
    if (clients) {
      delete clients[clientId];
      if (Object.keys(clients).length === 0) {
        this.docClients.delete(docId);
      }
    }

    const presence = this.docPresence.get(docId);
    if (presence) {
      delete presence[clientId];
      if (Object.keys(presence).length === 0) {
        this.docPresence.delete(docId);
      }
    }

    this.clientToDoc.delete(clientId);
  }

  private updateClientVectorClock(clientId: string, docId: string, vectorClock: VectorClock): void {
    const clients = this.docClients.get(docId);
    if (clients && clients[clientId]) {
      clients[clientId].vectorClock = { ...vectorClock };
    }
  }

  private incrementVectorClock(vectorClock: VectorClock, clientId: string): VectorClock {
    const newClock = { ...vectorClock };
    newClock[clientId] = (newClock[clientId] ?? 0) + 1;
    return newClock;
  }

  private getEventsAfterVectorClock(docId: string, vectorClock: VectorClock): Event[] {
    const maxSequence = this.getMaxSequenceFromVectorClock(docId, vectorClock);
    return this.eventStore.getEventsByDocId(docId, maxSequence);
  }

  private getMaxSequenceFromVectorClock(docId: string, vectorClock: VectorClock): number {
    const allEvents = this.eventStore.getEventsByDocId(docId, 0);
    let maxSequence = 0;

    for (const event of allEvents) {
      if (this.isEventAfterVectorClock(event, vectorClock)) {
        break;
      }
      if (event.sequence !== undefined && event.sequence > maxSequence) {
        maxSequence = event.sequence;
      }
    }

    return maxSequence;
  }

  private isEventAfterVectorClock(event: Event, vectorClock: VectorClock): boolean {
    for (const [clientId, eventCounter] of Object.entries(event.vectorClock)) {
      const localCounter = vectorClock[clientId] ?? 0;
      if (eventCounter > localCounter) {
        return true;
      }
    }
    return false;
  }

  private updatePresence(docId: string, clientId: string, userId: string, cursor?: CursorPosition, selection?: SelectionRange, user?: User): void {
    if (!this.docPresence.has(docId)) {
      this.docPresence.set(docId, {});
    }

    const presence = this.docPresence.get(docId)!;
    const existing = presence[clientId];

    presence[clientId] = {
      userId,
      clientId,
      user: user ?? existing?.user,
      online: true,
      cursor: cursor ?? existing?.cursor,
      selection: selection ?? existing?.selection,
      lastActive: Date.now(),
    };
  }

  private getPresenceData(docId: string, clientId: string): PresenceData | null {
    const presence = this.docPresence.get(docId);
    return presence?.[clientId] ?? null;
  }

  private getOnlinePresence(docId: string): PresenceData[] {
    const presence = this.docPresence.get(docId);
    if (!presence) {
      return [];
    }
    return Object.values(presence).filter((p) => p.online);
  }

  private broadcastPresenceUpdate(docId: string, clientId: string, userId: string, user?: User): void {
    const presenceData = this.getPresenceData(docId, clientId);
    if (!presenceData) {
      return;
    }

    const message: WebSocketServerMessage = {
      type: MessageType.PRESENCE,
      docId,
      clientId,
      timestamp: Date.now(),
      data: {
        ...presenceData,
        user,
      },
    };

    this.broadcastToDoc(docId, message, clientId);
  }

  private broadcastPresenceLeave(docId: string, clientId: string, userId: string): void {
    const message: WebSocketServerMessage = {
      type: MessageType.PRESENCE,
      docId,
      clientId,
      timestamp: Date.now(),
      data: {
        userId,
        clientId,
        online: false,
        lastActive: Date.now(),
      },
    };

    this.broadcastToDoc(docId, message, clientId);
  }

  private broadcastToDoc(docId: string, message: WebSocketServerMessage, excludeClientId?: string): void {
    const clients = this.docClients.get(docId);
    if (!clients) {
      return;
    }

    const serializedMessage = JSON.stringify(message);

    for (const [clientId, clientInfo] of Object.entries(clients)) {
      if (excludeClientId && clientId === excludeClientId) {
        continue;
      }

      if (clientInfo.socket.readyState === WebSocket.OPEN) {
        clientInfo.socket.send(serializedMessage);
      }
    }
  }

  private sendToClient(ws: WebSocket, message: WebSocketServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendAck(ws: WebSocket, clientId: string, docId: string, eventId: string | undefined, success: boolean, error?: string, vectorClock?: VectorClock): void {
    const message: WebSocketServerMessage = {
      type: MessageType.ACK,
      docId,
      clientId,
      timestamp: Date.now(),
      data: {
        eventId,
        vectorClock: vectorClock ?? {},
        success,
        error,
      },
    };

    this.sendToClient(ws, message);
  }

  getDocClientCount(docId: string): number {
    const clients = this.docClients.get(docId);
    return clients ? Object.keys(clients).length : 0;
  }

  getDocClients(docId: string): string[] {
    const clients = this.docClients.get(docId);
    return clients ? Object.keys(clients) : [];
  }

  getOnlineUsers(docId: string): PresenceData[] {
    return this.getOnlinePresence(docId);
  }

  close(): void {
    this.wss.close();
    this.docClients.clear();
    this.docPresence.clear();
    this.clientToDoc.clear();
  }
}
