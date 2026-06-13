import { WebSocketServer as WsWebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { EventType } from '../eventStore/types.js';
import { MessageType, } from './types.js';
export class WebSocketServerManager {
    wss;
    eventStore;
    docClients = new Map();
    docPresence = new Map();
    clientToDoc = new Map();
    constructor(server, eventStore) {
        this.wss = new WsWebSocketServer({ noServer: true });
        this.eventStore = eventStore;
        this.setupUpgradeHandler(server);
        this.setupConnectionHandler();
    }
    setupUpgradeHandler(server) {
        server.on('upgrade', (request, socket, head) => {
            this.wss.handleUpgrade(request, socket, head, (ws) => {
                this.wss.emit('connection', ws, request);
            });
        });
    }
    setupConnectionHandler() {
        this.wss.on('connection', (ws, request) => {
            this.handleConnection(ws, request);
        });
    }
    handleConnection(ws, request) {
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
    handleMessage(ws, clientId, docId, userId, rawData) {
        let message;
        try {
            const data = rawData instanceof Buffer ? rawData.toString() : String(rawData);
            message = JSON.parse(data);
        }
        catch {
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
    handleConnect(ws, clientId, docId, userId, message) {
        const vectorClock = message.vectorClock ?? {};
        const user = message.data?.user;
        this.registerClient(ws, clientId, docId, userId, vectorClock, user);
        const events = this.getEventsAfterVectorClock(docId, vectorClock);
        const onlineClients = this.getOnlinePresence(docId);
        const connectedMessage = {
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
    handleSync(ws, clientId, docId, userId, message) {
        const vectorClock = message.vectorClock ?? {};
        this.updateClientVectorClock(clientId, docId, vectorClock);
        const events = this.getEventsAfterVectorClock(docId, vectorClock);
        const syncMessage = {
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
    handleCellUpdate(ws, clientId, docId, userId, message) {
        const data = message.data;
        const vectorClock = message.vectorClock ?? {};
        if (!data?.cell) {
            this.sendAck(ws, clientId, docId, undefined, false, 'Missing cell data');
            return;
        }
        const newVectorClock = this.incrementVectorClock(vectorClock, clientId);
        const event = this.eventStore.appendEvent(docId, EventType.CELL_UPDATED, {
            sheetId: data.cell.sheetId,
            cellId: data.cell.id,
            value: data.cell.value,
        }, userId, newVectorClock, data.cell.id);
        this.updateClientVectorClock(clientId, docId, newVectorClock);
        if (data.cell.formula !== undefined) {
            this.eventStore.appendEvent(docId, EventType.CELL_FORMULA_UPDATED, {
                sheetId: data.cell.sheetId,
                cellId: data.cell.id,
                formula: data.cell.formula,
            }, userId, newVectorClock, data.cell.id);
        }
        if (data.cell.style) {
            this.eventStore.appendEvent(docId, EventType.CELL_STYLE_UPDATED, {
                sheetId: data.cell.sheetId,
                cellId: data.cell.id,
                style: data.cell.style,
            }, userId, newVectorClock, data.cell.id);
        }
        this.sendAck(ws, clientId, docId, event.id, true, undefined, newVectorClock);
        const broadcastMessage = {
            type: MessageType.CELL_UPDATE,
            docId,
            clientId,
            vectorClock: newVectorClock,
            timestamp: Date.now(),
            data: {
                cell: {
                    id: data.cell.id,
                    sheetId: data.cell.sheetId,
                    row: data.cell.row ?? 0,
                    col: data.cell.col ?? 0,
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
    handleFormulaUpdate(ws, clientId, docId, userId, message) {
        const data = message.data;
        const vectorClock = message.vectorClock ?? {};
        if (!data?.cellId || !data.sheetId) {
            this.sendAck(ws, clientId, docId, undefined, false, 'Missing cellId or sheetId');
            return;
        }
        const newVectorClock = this.incrementVectorClock(vectorClock, clientId);
        const event = this.eventStore.appendEvent(docId, EventType.CELL_FORMULA_UPDATED, {
            sheetId: data.sheetId,
            cellId: data.cellId,
            formula: data.formula,
        }, userId, newVectorClock, data.cellId);
        this.updateClientVectorClock(clientId, docId, newVectorClock);
        this.sendAck(ws, clientId, docId, event.id, true, undefined, newVectorClock);
        const broadcastMessage = {
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
    handlePresence(ws, clientId, docId, userId, message) {
        const data = message.data;
        this.updatePresence(docId, clientId, userId, data?.cursor, data?.selection, data?.user);
        const presenceData = this.getPresenceData(docId, clientId);
        if (presenceData) {
            const broadcastMessage = {
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
    handleOfflineChanges(ws, clientId, docId, userId, message) {
        const data = message.data;
        const vectorClock = message.vectorClock ?? {};
        if (!data?.events) {
            this.sendAck(ws, clientId, docId, undefined, false, 'Missing events data');
            return;
        }
        let currentVectorClock = { ...vectorClock };
        const createdEvents = [];
        for (const offlineEvent of data.events) {
            currentVectorClock = this.incrementVectorClock(currentVectorClock, clientId);
            const event = this.eventStore.appendEvent(docId, offlineEvent.eventType, offlineEvent.payload, userId, currentVectorClock, offlineEvent.cellId);
            createdEvents.push(event);
        }
        this.updateClientVectorClock(clientId, docId, currentVectorClock);
        this.sendAck(ws, clientId, docId, undefined, true, undefined, currentVectorClock);
        if (createdEvents.length > 0) {
            const syncMessage = {
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
    handleReconnect(ws, clientId, docId, userId, message) {
        const data = message.data;
        const vectorClock = message.vectorClock ?? {};
        const user = message.data?.user;
        this.registerClient(ws, clientId, docId, userId, vectorClock, user);
        let currentVectorClock = { ...vectorClock };
        const createdEvents = [];
        if (data?.offlineEvents && data.offlineEvents.length > 0) {
            for (const offlineEvent of data.offlineEvents) {
                currentVectorClock = this.incrementVectorClock(currentVectorClock, clientId);
                const event = this.eventStore.appendEvent(docId, offlineEvent.eventType, offlineEvent.payload, userId, currentVectorClock, offlineEvent.cellId);
                createdEvents.push(event);
            }
        }
        const missingEvents = this.getEventsAfterVectorClock(docId, currentVectorClock);
        const allEvents = [...createdEvents, ...missingEvents];
        const onlineClients = this.getOnlinePresence(docId);
        this.updateClientVectorClock(clientId, docId, currentVectorClock);
        const reconnectMessage = {
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
        const syncMessage = {
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
        const presenceBroadcastMessage = {
            type: MessageType.PRESENCE,
            docId,
            clientId,
            timestamp: Date.now(),
            data: {
                onlineClients,
            },
        };
        this.sendToClient(ws, presenceBroadcastMessage);
    }
    handleDisconnect(clientId, docId, userId) {
        this.removeClient(clientId, docId);
        this.broadcastPresenceLeave(docId, clientId, userId);
    }
    registerClient(ws, clientId, docId, userId, vectorClock, user) {
        if (!this.docClients.has(docId)) {
            this.docClients.set(docId, {});
        }
        const clients = this.docClients.get(docId);
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
    removeClient(clientId, docId) {
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
    updateClientVectorClock(clientId, docId, vectorClock) {
        const clients = this.docClients.get(docId);
        if (clients && clients[clientId]) {
            clients[clientId].vectorClock = { ...vectorClock };
        }
    }
    incrementVectorClock(vectorClock, clientId) {
        const newClock = { ...vectorClock };
        newClock[clientId] = (newClock[clientId] ?? 0) + 1;
        return newClock;
    }
    getEventsAfterVectorClock(docId, vectorClock) {
        const maxSequence = this.getMaxSequenceFromVectorClock(docId, vectorClock);
        return this.eventStore.getEventsByDocId(docId, maxSequence);
    }
    getMaxSequenceFromVectorClock(docId, vectorClock) {
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
    isEventAfterVectorClock(event, vectorClock) {
        for (const [clientId, eventCounter] of Object.entries(event.vectorClock)) {
            const localCounter = vectorClock[clientId] ?? 0;
            if (eventCounter > localCounter) {
                return true;
            }
        }
        return false;
    }
    updatePresence(docId, clientId, userId, cursor, selection, user) {
        if (!this.docPresence.has(docId)) {
            this.docPresence.set(docId, {});
        }
        const presence = this.docPresence.get(docId);
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
    getPresenceData(docId, clientId) {
        const presence = this.docPresence.get(docId);
        return presence?.[clientId] ?? null;
    }
    getOnlinePresence(docId) {
        const presence = this.docPresence.get(docId);
        if (!presence) {
            return [];
        }
        return Object.values(presence).filter((p) => p.online);
    }
    broadcastPresenceUpdate(docId, clientId, userId, user) {
        const presenceData = this.getPresenceData(docId, clientId);
        if (!presenceData) {
            return;
        }
        const message = {
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
    broadcastPresenceLeave(docId, clientId, userId) {
        const message = {
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
    broadcastToDoc(docId, message, excludeClientId) {
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
    sendToClient(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }
    sendAck(ws, clientId, docId, eventId, success, error, vectorClock) {
        const message = {
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
    getDocClientCount(docId) {
        const clients = this.docClients.get(docId);
        return clients ? Object.keys(clients).length : 0;
    }
    getDocClients(docId) {
        const clients = this.docClients.get(docId);
        return clients ? Object.keys(clients) : [];
    }
    getOnlineUsers(docId) {
        return this.getOnlinePresence(docId);
    }
    close() {
        this.wss.close();
        this.docClients.clear();
        this.docPresence.clear();
        this.clientToDoc.clear();
    }
}
