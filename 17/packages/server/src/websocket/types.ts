import type { WebSocket } from 'ws';
import type { VectorClock, Cell, CellPosition, CellRange, User } from '../types.js';
import type { Event, EventPayload } from '../eventStore/types.js';

export enum MessageType {
  CONNECTED = 'CONNECTED',
  SYNC = 'SYNC',
  CELL_UPDATE = 'CELL_UPDATE',
  FORMULA_UPDATE = 'FORMULA_UPDATE',
  PRESENCE = 'PRESENCE',
  ACK = 'ACK',
  OFFLINE_CHANGES = 'OFFLINE_CHANGES',
  RECONNECT = 'RECONNECT',
}

export interface ClientInfo {
  clientId: string;
  userId: string;
  docId: string;
  vectorClock: VectorClock;
  socket: WebSocket;
  user?: User;
}

export interface CursorPosition {
  sheetId: string;
  row: number;
  col: number;
}

export interface SelectionRange {
  sheetId: string;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

export interface PresenceData {
  userId: string;
  clientId: string;
  user?: User;
  online: boolean;
  cursor?: CursorPosition;
  selection?: SelectionRange;
  lastActive: number;
}

export interface BaseMessage {
  type: MessageType;
  docId: string;
  clientId: string;
  timestamp: number;
}

export interface ConnectedMessage extends BaseMessage {
  type: MessageType.CONNECTED;
  data: {
    clientId: string;
    vectorClock: VectorClock;
    onlineClients: PresenceData[];
    events: Event[];
  };
}

export interface SyncMessage extends BaseMessage {
  type: MessageType.SYNC;
  vectorClock: VectorClock;
  data?: {
    events: Event[];
  };
}

export interface CellUpdateMessage extends BaseMessage {
  type: MessageType.CELL_UPDATE;
  vectorClock: VectorClock;
  data: {
    cell: Cell;
    eventId?: string;
  };
}

export interface FormulaUpdateMessage extends BaseMessage {
  type: MessageType.FORMULA_UPDATE;
  vectorClock: VectorClock;
  data: {
    cellId: string;
    formula: string | null;
    sheetId: string;
    eventId?: string;
  };
}

export interface PresenceMessage extends BaseMessage {
  type: MessageType.PRESENCE;
  data: PresenceData;
}

export interface AckMessage extends BaseMessage {
  type: MessageType.ACK;
  data: {
    eventId?: string;
    vectorClock: VectorClock;
    success: boolean;
    error?: string;
  };
}

export interface OfflineChangesMessage extends BaseMessage {
  type: MessageType.OFFLINE_CHANGES;
  vectorClock: VectorClock;
  data: {
    events: Array<{
      eventType: string;
      payload: EventPayload;
      vectorClock: VectorClock;
      cellId?: string;
    }>;
  };
}

export interface ReconnectMessage extends BaseMessage {
  type: MessageType.RECONNECT;
  vectorClock: VectorClock;
  data: {
    lastKnownSequence?: number;
    offlineEvents?: Array<{
      eventType: string;
      payload: EventPayload;
      vectorClock: VectorClock;
      cellId?: string;
    }>;
  };
}

export type WebSocketServerMessage =
  | ConnectedMessage
  | SyncMessage
  | CellUpdateMessage
  | FormulaUpdateMessage
  | PresenceMessage
  | AckMessage
  | OfflineChangesMessage
  | ReconnectMessage;

export interface IncomingMessage {
  type: string;
  docId: string;
  clientId: string;
  vectorClock?: VectorClock;
  data?: unknown;
  timestamp?: number;
}
