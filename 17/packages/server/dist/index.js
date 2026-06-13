import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { DocumentManager } from './DocumentManager.js';
import { createRoutes } from './api/routes.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = parseInt(process.env.PORT || '3001', 10);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', 'data.db');
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const documentManager = new DocumentManager(DB_PATH);
const apiRoutes = createRoutes(documentManager);
app.use(cors());
app.use(express.json());
app.use('/api', apiRoutes);
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});
const connectedClients = new Map();
wss.on('connection', (ws) => {
    let currentClient = null;
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            if (message.type === 'join' && message.docId && message.clientId) {
                currentClient = { ws, docId: message.docId, clientId: message.clientId };
                if (!connectedClients.has(message.docId)) {
                    connectedClients.set(message.docId, new Set());
                }
                connectedClients.get(message.docId).add(currentClient);
                const events = documentManager.getEventStore().getEventsByDocId(message.docId);
                ws.send(JSON.stringify({
                    type: 'init',
                    docId: message.docId,
                    data: events,
                    timestamp: Date.now(),
                }));
                return;
            }
            if (currentClient && message.docId === currentClient.docId) {
                const clients = connectedClients.get(message.docId);
                if (clients) {
                    for (const client of clients) {
                        if (client.clientId !== message.clientId && client.ws.readyState === WebSocket.OPEN) {
                            client.ws.send(JSON.stringify(message));
                        }
                    }
                }
            }
        }
        catch (error) {
            console.error('WebSocket message error:', error);
        }
    });
    ws.on('close', () => {
        if (currentClient) {
            const clients = connectedClients.get(currentClient.docId);
            if (clients) {
                clients.delete(currentClient);
                if (clients.size === 0) {
                    connectedClients.delete(currentClient.docId);
                }
            }
        }
    });
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    wss.close(() => {
        documentManager.close();
        server.close(() => {
            process.exit(0);
        });
    });
});
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`API: http://localhost:${PORT}/api`);
});
