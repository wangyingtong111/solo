import * as Y from 'yjs';
import type {
  User,
  Cell,
  SheetMeta,
  DocumentMeta,
  VectorClock,
  CursorPosition,
  SelectionRange,
  PresenceUser,
} from '../types/index';

enum MessageType {
  CONNECTED = 'CONNECTED',
  SYNC = 'SYNC',
  CELL_UPDATE = 'CELL_UPDATE',
  FORMULA_UPDATE = 'FORMULA_UPDATE',
  PRESENCE = 'PRESENCE',
  ACK = 'ACK',
  OFFLINE_CHANGES = 'OFFLINE_CHANGES',
  RECONNECT = 'RECONNECT',
}

interface YCellData {
  value: string | number | boolean | null;
  formula: string | null;
  metadata: {
    userId?: string;
    updatedAt?: number;
    style?: Record<string, unknown>;
  };
}

interface YSheetData {
  id: string;
  name: string;
  rowCount: number;
  colCount: number;
  index: number;
}

interface YDocMeta {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
}

interface OfflineEvent {
  eventType: string;
  payload: Record<string, unknown>;
  vectorClock: VectorClock;
  cellId?: string;
}

interface BaseMessage {
  type: MessageType;
  docId: string;
  clientId: string;
  timestamp: number;
  vectorClock?: VectorClock;
  data?: unknown;
}

export type DocChangeCallback = (changes: {
  cells?: string[];
  sheets?: boolean;
  meta?: boolean;
}) => void;

export type PresenceCallback = (users: PresenceUser[]) => void;

export type ConnectionCallback = (connected: boolean) => void;

export class YjsDocManager {
  private doc: Y.Doc;
  private cells: Y.Map<YCellData>;
  private sheets: Y.Array<YSheetData>;
  private docMeta: Y.Map<YDocMeta>;

  private docId: string;
  private userId: string;
  private clientId: string;
  private user: User;

  private vectorClock: VectorClock;
  private webSocket: WebSocket | null = null;
  private wsUrl: string;

  private changeCallbacks: Set<DocChangeCallback> = new Set();
  private presenceCallbacks: Set<PresenceCallback> = new Set();
  private connectionCallbacks: Set<ConnectionCallback> = new Set();
  private presenceUsers: Map<string, PresenceUser> = new Map();

  private offlineStorageKey: string;
  private reconnectTimer: number | null = null;
  private isConnecting: boolean = false;
  private pendingAcks: Map<string, { resolve: () => void; reject: (error: string) => void }> = new Map();

  constructor(docId: string, user: User, wsUrl: string = 'ws://localhost:3000') {
    this.docId = docId;
    this.userId = user.id;
    this.user = user;
    this.wsUrl = wsUrl;
    this.vectorClock = {};
    this.offlineStorageKey = `collab-sheet-offline-${docId}-${user.id}`;

    this.clientId = this.loadClientId();

    this.doc = new Y.Doc();
    this.cells = this.doc.getMap<YCellData>('cells');
    this.sheets = this.doc.getArray<YSheetData>('sheets');
    this.docMeta = this.doc.getMap<YDocMeta>('meta');

    this.setupYjsObservers();
  }

  private loadClientId(): string {
    const stored = localStorage.getItem(`collab-sheet-clientId-${this.userId}`);
    if (stored) {
      return stored;
    }
    const newId = `client-${this.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem(`collab-sheet-clientId-${this.userId}`, newId);
    return newId;
  }

  private setupYjsObservers(): void {
    this.cells.observe((event) => {
      const changedKeys = Array.from(event.keys.keys());
      this.notifyChangeCallbacks({ cells: changedKeys });
    });

    this.sheets.observe(() => {
      this.notifyChangeCallbacks({ sheets: true });
    });

    this.docMeta.observe(() => {
      this.notifyChangeCallbacks({ meta: true });
    });
  }

  private notifyChangeCallbacks(changes: { cells?: string[]; sheets?: boolean; meta?: boolean }): void {
    for (const callback of this.changeCallbacks) {
      callback(changes);
    }
  }

  connectWebSocket(): void {
    if (this.isConnecting || (this.webSocket && this.webSocket.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;

    const url = `${this.wsUrl}?docId=${encodeURIComponent(this.docId)}&userId=${encodeURIComponent(this.userId)}&clientId=${encodeURIComponent(this.clientId)}`;
    this.webSocket = new WebSocket(url);

    this.webSocket.onopen = () => {
      this.isConnecting = false;
      this.notifyConnectionCallbacks(true);
      this.sendConnectMessage();
    };

    this.webSocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as BaseMessage;
        this.handleIncomingMessage(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.webSocket.onerror = () => {
      this.isConnecting = false;
    };

    this.webSocket.onclose = () => {
      this.isConnecting = false;
      this.webSocket = null;
      this.notifyConnectionCallbacks(false);
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, 3000);
  }

  private sendConnectMessage(): void {
    const hasOfflineChanges = this.hasOfflineChanges();

    if (hasOfflineChanges) {
      const offlineEvents = this.loadOfflineChanges();
      this.sendMessage({
        type: MessageType.RECONNECT,
        docId: this.docId,
        clientId: this.clientId,
        timestamp: Date.now(),
        vectorClock: { ...this.vectorClock },
        data: {
          user: this.user,
          offlineEvents,
        },
      });
    } else {
      this.sendMessage({
        type: MessageType.CONNECTED,
        docId: this.docId,
        clientId: this.clientId,
        timestamp: Date.now(),
        vectorClock: { ...this.vectorClock },
        data: {
          user: this.user,
        },
      });
    }
  }

  private sendMessage(message: BaseMessage): void {
    if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
      this.webSocket.send(JSON.stringify(message));
    }
  }

  handleIncomingMessage(message: BaseMessage): void {
    switch (message.type) {
      case MessageType.CONNECTED:
        this.handleConnected(message);
        break;
      case MessageType.SYNC:
        this.handleSync(message);
        break;
      case MessageType.CELL_UPDATE:
        this.handleCellUpdate(message);
        break;
      case MessageType.FORMULA_UPDATE:
        this.handleFormulaUpdate(message);
        break;
      case MessageType.PRESENCE:
        this.handlePresence(message);
        break;
      case MessageType.ACK:
        this.handleAck(message);
        break;
      case MessageType.RECONNECT:
        this.handleReconnect(message);
        break;
    }
  }

  private handleConnected(message: BaseMessage): void {
    const data = message.data as {
      clientId: string;
      vectorClock: VectorClock;
      onlineClients: Array<{
        userId: string;
        clientId: string;
        user?: User;
        online: boolean;
        cursor?: CursorPosition;
        selection?: SelectionRange;
        lastActive: number;
      }>;
      events: Array<{
        eventType: string;
        payload: Record<string, unknown>;
        vectorClock: VectorClock;
        cellId?: string;
      }>;
    };

    this.vectorClock = { ...data.vectorClock };

    for (const client of data.onlineClients) {
      this.updatePresenceUser(client);
    }
    this.notifyPresenceCallbacks();

    for (const event of data.events) {
      this.applyEvent(event);
    }

    this.clearOfflineChanges();
  }

  private handleSync(message: BaseMessage): void {
    if (message.vectorClock) {
      this.mergeVectorClock(message.vectorClock);
    }

    const data = message.data as {
      events: Array<{
        eventType: string;
        payload: Record<string, unknown>;
        vectorClock: VectorClock;
        cellId?: string;
      }>;
    };

    if (data?.events) {
      for (const event of data.events) {
        this.applyEvent(event);
      }
    }
  }

  private handleCellUpdate(message: BaseMessage): void {
    if (message.vectorClock) {
      this.mergeVectorClock(message.vectorClock);
    }

    const data = message.data as {
      cell: Cell;
      eventId?: string;
    };

    if (data?.cell) {
      this.applyCellToYjs(data.cell);
    }
  }

  private handleFormulaUpdate(message: BaseMessage): void {
    if (message.vectorClock) {
      this.mergeVectorClock(message.vectorClock);
    }

    const data = message.data as {
      cellId: string;
      formula: string | null;
      sheetId: string;
      eventId?: string;
    };

    if (data?.cellId) {
      const existing = this.cells.get(data.cellId);
      if (existing) {
        this.cells.set(data.cellId, {
          ...existing,
          formula: data.formula,
        });
      } else {
        const pos = this.parseCellId(data.cellId);
        this.cells.set(data.cellId, {
          value: null,
          formula: data.formula,
          metadata: {
            updatedAt: Date.now(),
          },
        });
        if (pos) {
          this.ensureSheetExists(pos.sheetId);
        }
      }
    }
  }

  private handlePresence(message: BaseMessage): void {
    const data = message.data as {
      userId: string;
      clientId: string;
      user?: User;
      online: boolean;
      cursor?: CursorPosition;
      selection?: SelectionRange;
      lastActive: number;
      onlineClients?: Array<{
        userId: string;
        clientId: string;
        user?: User;
        online: boolean;
        cursor?: CursorPosition;
        selection?: SelectionRange;
        lastActive: number;
      }>;
    };

    if (data.onlineClients) {
      this.presenceUsers.clear();
      for (const client of data.onlineClients) {
        this.updatePresenceUser(client);
      }
    } else {
      this.updatePresenceUser(data);
    }

    this.notifyPresenceCallbacks();
  }

  private updatePresenceUser(data: {
    userId: string;
    clientId: string;
    user?: User;
    online: boolean;
    cursor?: CursorPosition;
    selection?: SelectionRange;
    lastActive: number;
  }): void {
    const existing = this.presenceUsers.get(data.clientId);
    const baseUser = data.user || existing || {
      id: data.userId,
      name: `User-${data.userId.slice(0, 6)}`,
      color: '#3b82f6',
      role: 'viewer' as const,
    };

    this.presenceUsers.set(data.clientId, {
      ...baseUser,
      id: data.userId,
      clientId: data.clientId,
      isOnline: data.online,
      cursor: data.cursor ?? existing?.cursor,
      selection: data.selection ?? existing?.selection,
      lastActive: data.lastActive,
    });
  }

  private notifyPresenceCallbacks(): void {
    const users = Array.from(this.presenceUsers.values());
    for (const callback of this.presenceCallbacks) {
      callback(users);
    }
  }

  private handleAck(message: BaseMessage): void {
    const data = message.data as {
      eventId?: string;
      vectorClock: VectorClock;
      success: boolean;
      error?: string;
    };

    if (data?.vectorClock) {
      this.mergeVectorClock(data.vectorClock);
    }

    if (data?.eventId) {
      const pending = this.pendingAcks.get(data.eventId);
      if (pending) {
        if (data.success) {
          pending.resolve();
        } else {
          pending.reject(data.error || 'Operation failed');
        }
        this.pendingAcks.delete(data.eventId);
      }
    }
  }

  private handleReconnect(message: BaseMessage): void {
    if (message.vectorClock) {
      this.mergeVectorClock(message.vectorClock);
    }
    this.clearOfflineChanges();
  }

  private mergeVectorClock(remoteClock: VectorClock): void {
    for (const [clientId, counter] of Object.entries(remoteClock)) {
      const localCounter = this.vectorClock[clientId] ?? 0;
      if (counter > localCounter) {
        this.vectorClock[clientId] = counter;
      }
    }
  }

  private incrementVectorClock(): VectorClock {
    const current = this.vectorClock[this.clientId] ?? 0;
    this.vectorClock[this.clientId] = current + 1;
    return { ...this.vectorClock };
  }

  private applyEvent(event: {
    eventType: string;
    payload: Record<string, unknown>;
    vectorClock: VectorClock;
    cellId?: string;
  }): void {
    this.mergeVectorClock(event.vectorClock);

    switch (event.eventType) {
      case 'DOCUMENT_CREATED':
      case 'DOCUMENT_UPDATED': {
        const payload = event.payload as { title?: string; ownerId?: string; createdAt?: number; updatedAt?: number };
        const currentMeta = this.docMeta.get('current');
        if (currentMeta) {
          this.docMeta.set('current', {
            ...currentMeta,
            name: payload.title ?? currentMeta.name,
            ownerId: payload.ownerId ?? currentMeta.ownerId,
            updatedAt: payload.updatedAt ?? currentMeta.updatedAt,
          });
        } else {
          this.docMeta.set('current', {
            id: this.docId,
            name: payload.title ?? 'Untitled',
            ownerId: payload.ownerId ?? this.userId,
            createdAt: payload.createdAt ?? Date.now(),
            updatedAt: payload.updatedAt ?? Date.now(),
          });
        }
        break;
      }
      case 'SHEET_CREATED': {
        const payload = event.payload as { sheetId: string; name: string; index: number };
        const existing = this.sheets.toArray().find((s) => s.id === payload.sheetId);
        if (!existing) {
          this.sheets.push([{
            id: payload.sheetId,
            name: payload.name,
            rowCount: 100,
            colCount: 26,
            index: payload.index,
          }]);
        }
        break;
      }
      case 'SHEET_UPDATED': {
        const payload = event.payload as { sheetId: string; name?: string; index?: number };
        const sheetsArr = this.sheets.toArray();
        const idx = sheetsArr.findIndex((s) => s.id === payload.sheetId);
        if (idx !== -1) {
          const updated = { ...sheetsArr[idx] };
          if (payload.name !== undefined) updated.name = payload.name;
          if (payload.index !== undefined) updated.index = payload.index;
          this.doc.transact(() => {
            this.sheets.delete(idx, 1);
            this.sheets.insert(idx, [updated]);
          });
        }
        break;
      }
      case 'SHEET_DELETED': {
        const payload = event.payload as { sheetId: string };
        const sheetsArr = this.sheets.toArray();
        const idx = sheetsArr.findIndex((s) => s.id === payload.sheetId);
        if (idx !== -1) {
          this.sheets.delete(idx, 1);
        }
        break;
      }
      case 'CELL_UPDATED': {
        const payload = event.payload as { sheetId: string; cellId: string; value: string | number | boolean | null };
        const pos = this.parseCellId(payload.cellId);
        if (pos) {
          this.applyCellToYjs({
            id: payload.cellId,
            sheetId: payload.sheetId,
            row: pos.row,
            col: pos.col,
            value: payload.value,
            formula: this.cells.get(payload.cellId)?.formula ?? null,
            metadata: this.cells.get(payload.cellId)?.metadata ?? {},
          });
        }
        break;
      }
      case 'CELL_FORMULA_UPDATED': {
        const payload = event.payload as { sheetId: string; cellId: string; formula: string | null };
        const existing = this.cells.get(payload.cellId);
        const pos = this.parseCellId(payload.cellId);
        if (existing) {
          this.cells.set(payload.cellId, {
            ...existing,
            formula: payload.formula,
          });
        } else if (pos) {
          this.cells.set(payload.cellId, {
            value: null,
            formula: payload.formula,
            metadata: {},
          });
          this.ensureSheetExists(pos.sheetId);
        }
        break;
      }
      case 'CELL_STYLE_UPDATED': {
        const payload = event.payload as { sheetId: string; cellId: string; style: Record<string, unknown> };
        const existing = this.cells.get(payload.cellId);
        const pos = this.parseCellId(payload.cellId);
        if (existing) {
          this.cells.set(payload.cellId, {
            ...existing,
            metadata: {
              ...existing.metadata,
              style: payload.style,
            },
          });
        } else if (pos) {
          this.cells.set(payload.cellId, {
            value: null,
            formula: null,
            metadata: {
              style: payload.style,
            },
          });
          this.ensureSheetExists(pos.sheetId);
        }
        break;
      }
    }
  }

  private applyCellToYjs(cell: Cell): void {
    const existing = this.cells.get(cell.id);
    const cellData: YCellData = {
      value: cell.value,
      formula: cell.formula ?? existing?.formula ?? null,
      metadata: {
        ...existing?.metadata,
        ...cell.metadata,
      },
    };
    this.cells.set(cell.id, cellData);
    this.ensureSheetExists(cell.sheetId);
  }

  private ensureSheetExists(sheetId: string): void {
    const existing = this.sheets.toArray().find((s) => s.id === sheetId);
    if (!existing) {
      this.sheets.push([{
        id: sheetId,
        name: `Sheet-${sheetId.slice(0, 6)}`,
        rowCount: 100,
        colCount: 26,
        index: this.sheets.length,
      }]);
    }
  }

  private parseCellId(cellId: string): { sheetId: string; row: number; col: number } | null {
    const match = cellId.match(/^(.+)!([A-Z]+)(\d+)$/);
    if (!match) return null;
    return {
      sheetId: match[1],
      col: this.letterToCol(match[2]),
      row: parseInt(match[3], 10),
    };
  }

  private letterToCol(letters: string): number {
    let result = 0;
    for (let i = 0; i < letters.length; i++) {
      result = result * 26 + (letters.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
    }
    return result;
  }

  private colToLetter(col: number): string {
    let result = '';
    let remaining = col;
    while (remaining > 0) {
      const mod = (remaining - 1) % 26;
      result = String.fromCharCode('A'.charCodeAt(0) + mod) + result;
      remaining = Math.floor((remaining - 1) / 26);
    }
    return result || 'A';
  }

  buildCellId(sheetId: string, row: number, col: number): string {
    return `${sheetId}!${this.colToLetter(col)}${row}`;
  }

  updateCell(sheetId: string, row: number, col: number, value: string | number | boolean | null): Promise<void> {
    const cellId = this.buildCellId(sheetId, row, col);
    const existing = this.cells.get(cellId);
    const vectorClock = this.incrementVectorClock();

    const cellData: YCellData = {
      value,
      formula: existing?.formula ?? null,
      metadata: {
        ...existing?.metadata,
        userId: this.userId,
        updatedAt: Date.now(),
      },
    };

    this.cells.set(cellId, cellData);
    this.ensureSheetExists(sheetId);

    const eventId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    return new Promise((resolve, reject) => {
      if (this.isOnline()) {
        this.pendingAcks.set(eventId, { resolve, reject });
        this.sendMessage({
          type: MessageType.CELL_UPDATE,
          docId: this.docId,
          clientId: this.clientId,
          timestamp: Date.now(),
          vectorClock,
          data: {
            cell: {
              id: cellId,
              sheetId,
              row,
              col,
              value,
              formula: existing?.formula ?? null,
              metadata: cellData.metadata,
            },
            eventId,
          },
        });

        window.setTimeout(() => {
          if (this.pendingAcks.has(eventId)) {
            this.pendingAcks.delete(eventId);
            this.cacheOfflineChange({
              eventType: 'CELL_UPDATED',
              payload: { sheetId, cellId, value },
              vectorClock,
              cellId,
            });
            resolve();
          }
        }, 5000);
      } else {
        this.cacheOfflineChange({
          eventType: 'CELL_UPDATED',
          payload: { sheetId, cellId, value },
          vectorClock,
          cellId,
        });
        resolve();
      }
    });
  }

  updateFormula(sheetId: string, row: number, col: number, formula: string | null): Promise<void> {
    const cellId = this.buildCellId(sheetId, row, col);
    const existing = this.cells.get(cellId);
    const vectorClock = this.incrementVectorClock();

    if (existing) {
      this.cells.set(cellId, {
        ...existing,
        formula,
        metadata: {
          ...existing.metadata,
          userId: this.userId,
          updatedAt: Date.now(),
        },
      });
    } else {
      this.cells.set(cellId, {
        value: null,
        formula,
        metadata: {
          userId: this.userId,
          updatedAt: Date.now(),
        },
      });
      this.ensureSheetExists(sheetId);
    }

    const eventId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    return new Promise((resolve, reject) => {
      if (this.isOnline()) {
        this.pendingAcks.set(eventId, { resolve, reject });
        this.sendMessage({
          type: MessageType.FORMULA_UPDATE,
          docId: this.docId,
          clientId: this.clientId,
          timestamp: Date.now(),
          vectorClock,
          data: {
            cellId,
            formula,
            sheetId,
            eventId,
          },
        });

        window.setTimeout(() => {
          if (this.pendingAcks.has(eventId)) {
            this.pendingAcks.delete(eventId);
            this.cacheOfflineChange({
              eventType: 'CELL_FORMULA_UPDATED',
              payload: { sheetId, cellId, formula },
              vectorClock,
              cellId,
            });
            resolve();
          }
        }, 5000);
      } else {
        this.cacheOfflineChange({
          eventType: 'CELL_FORMULA_UPDATED',
          payload: { sheetId, cellId, formula },
          vectorClock,
          cellId,
        });
        resolve();
      }
    });
  }

  updatePresence(cursor?: CursorPosition, selection?: SelectionRange): void {
    if (!this.isOnline()) return;

    this.sendMessage({
      type: MessageType.PRESENCE,
      docId: this.docId,
      clientId: this.clientId,
      timestamp: Date.now(),
      data: {
        cursor,
        selection,
        user: this.user,
      },
    });
  }

  getCell(cellId: string): Cell | null {
    const data = this.cells.get(cellId);
    if (!data) {
      const pos = this.parseCellId(cellId);
      if (!pos) return null;
      return {
        id: cellId,
        sheetId: pos.sheetId,
        row: pos.row,
        col: pos.col,
        value: null,
        formula: null,
        metadata: {},
      };
    }

    const pos = this.parseCellId(cellId);
    if (!pos) return null;

    return {
      id: cellId,
      sheetId: pos.sheetId,
      row: pos.row,
      col: pos.col,
      value: data.value,
      formula: data.formula,
      metadata: data.metadata,
    };
  }

  getCellsBySheet(sheetId: string): Cell[] {
    const result: Cell[] = [];
    this.cells.forEach((data, cellId) => {
      if (cellId.startsWith(`${sheetId}!`)) {
        const pos = this.parseCellId(cellId);
        if (pos) {
          result.push({
            id: cellId,
            sheetId: pos.sheetId,
            row: pos.row,
            col: pos.col,
            value: data.value,
            formula: data.formula,
            metadata: data.metadata,
          });
        }
      }
    });
    return result;
  }

  getSheets(): SheetMeta[] {
    return this.sheets.toArray().map((s) => ({
      ...s,
      docId: this.docId,
    }));
  }

  getDocumentMeta(): DocumentMeta | null {
    const meta = this.docMeta.get('current');
    if (!meta) return null;
    return { ...meta };
  }

  getVectorClock(): VectorClock {
    return { ...this.vectorClock };
  }

  subscribeToChanges(callback: DocChangeCallback): () => void {
    this.changeCallbacks.add(callback);
    return () => {
      this.changeCallbacks.delete(callback);
    };
  }

  subscribeToPresence(callback: PresenceCallback): () => void {
    this.presenceCallbacks.add(callback);
    return () => {
      this.presenceCallbacks.delete(callback);
    };
  }

  subscribeToConnection(callback: ConnectionCallback): () => void {
    this.connectionCallbacks.add(callback);
    return () => {
      this.connectionCallbacks.delete(callback);
    };
  }

  private notifyConnectionCallbacks(connected: boolean): void {
    for (const callback of this.connectionCallbacks) {
      callback(connected);
    }
  }

  isOnline(): boolean {
    return this.webSocket !== null && this.webSocket.readyState === WebSocket.OPEN;
  }

  private hasOfflineChanges(): boolean {
    const stored = localStorage.getItem(this.offlineStorageKey);
    if (!stored) return false;
    try {
      const parsed = JSON.parse(stored) as OfflineEvent[];
      return parsed.length > 0;
    } catch {
      return false;
    }
  }

  private loadOfflineChanges(): OfflineEvent[] {
    const stored = localStorage.getItem(this.offlineStorageKey);
    if (!stored) return [];
    try {
      return JSON.parse(stored) as OfflineEvent[];
    } catch {
      return [];
    }
  }

  private cacheOfflineChange(event: OfflineEvent): void {
    const events = this.loadOfflineChanges();
    events.push(event);
    localStorage.setItem(this.offlineStorageKey, JSON.stringify(events));
  }

  private clearOfflineChanges(): void {
    localStorage.removeItem(this.offlineStorageKey);
  }

  flushOfflineChanges(): void {
    if (!this.isOnline()) return;

    const events = this.loadOfflineChanges();
    if (events.length === 0) return;

    const vectorClock = this.getVectorClock();

    this.sendMessage({
      type: MessageType.OFFLINE_CHANGES,
      docId: this.docId,
      clientId: this.clientId,
      timestamp: Date.now(),
      vectorClock,
      data: {
        events,
      },
    });

    this.clearOfflineChanges();
  }

  getYDoc(): Y.Doc {
    return this.doc;
  }

  getClientId(): string {
    return this.clientId;
  }

  disconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.webSocket) {
      this.webSocket.close();
      this.webSocket = null;
    }
  }

  destroy(): void {
    this.disconnect();
    this.changeCallbacks.clear();
    this.presenceCallbacks.clear();
    this.connectionCallbacks.clear();
    this.presenceUsers.clear();
    this.pendingAcks.clear();
    this.doc.destroy();
  }
}
