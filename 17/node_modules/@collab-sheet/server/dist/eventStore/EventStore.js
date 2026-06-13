import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { EventType } from './types.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export class EventStore {
    db;
    constructor(dbPath = ':memory:') {
        this.db = new Database(dbPath);
        this.initSchema();
    }
    initSchema() {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf-8');
        this.db.exec(schema);
    }
    appendEvent(docId, eventType, payload, userId, vectorClock, cellId) {
        const transaction = this.db.transaction(() => {
            const maxSequenceRow = this.db
                .prepare('SELECT COALESCE(MAX(sequence), 0) as max_seq FROM events WHERE doc_id = ?')
                .get(docId);
            const sequence = maxSequenceRow.max_seq + 1;
            const id = uuidv4();
            const timestamp = Date.now();
            this.db
                .prepare(`INSERT INTO events (id, doc_id, event_type, cell_id, user_id, timestamp, payload_json, vector_clock_json, sequence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(id, docId, eventType, cellId ?? null, userId, timestamp, JSON.stringify(payload), JSON.stringify(vectorClock), sequence);
            this.db
                .prepare('UPDATE documents SET version = ?, updated_at = ? WHERE id = ?')
                .run(sequence, timestamp, docId);
            return {
                id,
                docId,
                eventType,
                cellId,
                userId,
                timestamp,
                payload,
                vectorClock,
                sequence,
            };
        });
        return transaction();
    }
    getEventsByDocId(docId, fromSequence = 0) {
        const rows = this.db
            .prepare(`SELECT id, doc_id, event_type, cell_id, user_id, timestamp, payload_json, vector_clock_json, sequence
         FROM events
         WHERE doc_id = ? AND sequence > ?
         ORDER BY sequence ASC`)
            .all(docId, fromSequence);
        return rows.map((row) => ({
            id: row.id,
            docId: row.doc_id,
            eventType: row.event_type,
            cellId: row.cell_id ?? undefined,
            userId: row.user_id,
            timestamp: row.timestamp,
            payload: JSON.parse(row.payload_json),
            vectorClock: JSON.parse(row.vector_clock_json),
            sequence: row.sequence,
        }));
    }
    getEventsByCellId(docId, cellId) {
        const rows = this.db
            .prepare(`SELECT id, doc_id, event_type, cell_id, user_id, timestamp, payload_json, vector_clock_json, sequence
         FROM events
         WHERE doc_id = ? AND cell_id = ?
         ORDER BY sequence ASC`)
            .all(docId, cellId);
        return rows.map((row) => ({
            id: row.id,
            docId: row.doc_id,
            eventType: row.event_type,
            cellId: row.cell_id ?? undefined,
            userId: row.user_id,
            timestamp: row.timestamp,
            payload: JSON.parse(row.payload_json),
            vectorClock: JSON.parse(row.vector_clock_json),
            sequence: row.sequence,
        }));
    }
    getEventsByTimeRange(docId, startTime, endTime) {
        const rows = this.db
            .prepare(`SELECT id, doc_id, event_type, cell_id, user_id, timestamp, payload_json, vector_clock_json, sequence
         FROM events
         WHERE doc_id = ? AND timestamp >= ? AND timestamp <= ?
         ORDER BY timestamp ASC`)
            .all(docId, startTime, endTime);
        return rows.map((row) => ({
            id: row.id,
            docId: row.doc_id,
            eventType: row.event_type,
            cellId: row.cell_id ?? undefined,
            userId: row.user_id,
            timestamp: row.timestamp,
            payload: JSON.parse(row.payload_json),
            vectorClock: JSON.parse(row.vector_clock_json),
            sequence: row.sequence,
        }));
    }
    getSnapshot(docId, version) {
        let row;
        if (version !== undefined) {
            row = this.db
                .prepare(`SELECT id, doc_id, version, snapshot_data, created_at
           FROM snapshots
           WHERE doc_id = ? AND version <= ?
           ORDER BY version DESC
           LIMIT 1`)
                .get(docId, version);
        }
        else {
            row = this.db
                .prepare(`SELECT id, doc_id, version, snapshot_data, created_at
           FROM snapshots
           WHERE doc_id = ?
           ORDER BY version DESC
           LIMIT 1`)
                .get(docId);
        }
        if (!row) {
            return null;
        }
        return {
            id: row.id,
            docId: row.doc_id,
            version: row.version,
            snapshotData: JSON.parse(row.snapshot_data),
            createdAt: row.created_at,
        };
    }
    saveSnapshot(docId, snapshotData) {
        const transaction = this.db.transaction(() => {
            const docRow = this.db
                .prepare('SELECT version FROM documents WHERE id = ?')
                .get(docId);
            if (!docRow) {
                throw new Error(`Document not found: ${docId}`);
            }
            const id = uuidv4();
            const createdAt = Date.now();
            const version = docRow.version;
            this.db
                .prepare(`INSERT INTO snapshots (id, doc_id, version, snapshot_data, created_at)
           VALUES (?, ?, ?, ?, ?)`)
                .run(id, docId, version, JSON.stringify(snapshotData), createdAt);
            return {
                id,
                docId,
                version,
                snapshotData,
                createdAt,
            };
        });
        return transaction();
    }
    replayToVersion(docId, targetVersion) {
        const snapshot = this.getSnapshot(docId, targetVersion);
        const fromSequence = snapshot ? snapshot.version : 0;
        const events = this.getEventsByDocId(docId, fromSequence).filter((event) => event.sequence !== undefined && event.sequence <= targetVersion);
        let document = null;
        if (snapshot) {
            document = snapshot.snapshotData;
        }
        for (const event of events) {
            document = this.applyEvent(document, event);
        }
        return { document, events };
    }
    applyEvent(document, event) {
        if (!document) {
            if (event.eventType === EventType.DOCUMENT_CREATED) {
                const payload = event.payload;
                return {
                    id: event.docId,
                    title: payload.title,
                    ownerId: payload.ownerId,
                    createdAt: payload.createdAt,
                    updatedAt: event.timestamp,
                    version: event.sequence ?? 1,
                };
            }
            return null;
        }
        const updatedDoc = { ...document, updatedAt: event.timestamp, version: event.sequence ?? document.version };
        switch (event.eventType) {
            case EventType.DOCUMENT_UPDATED: {
                const payload = event.payload;
                if (payload.title !== undefined) {
                    updatedDoc.title = payload.title;
                }
                break;
            }
            case EventType.DOCUMENT_DELETED: {
                const payload = event.payload;
                updatedDoc.deletedAt = payload.deletedAt;
                break;
            }
            default:
                break;
        }
        return updatedDoc;
    }
    close() {
        this.db.close();
    }
}
