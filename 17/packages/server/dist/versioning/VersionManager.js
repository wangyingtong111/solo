import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { EventStore } from '../eventStore/EventStore.js';
import { EventType } from '../eventStore/types.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export class VersionManager {
    db;
    eventStore;
    constructor(dbPath = ':memory:') {
        this.db = new Database(dbPath);
        this.eventStore = new EventStore(dbPath);
        this.initSchema();
    }
    initSchema() {
        const schemaPath = path.join(__dirname, 'schema.sql');
        if (fs.existsSync(schemaPath)) {
            const schema = fs.readFileSync(schemaPath, 'utf-8');
            this.db.exec(schema);
        }
        else {
            this.db.exec(`
        CREATE TABLE IF NOT EXISTS version_snapshots (
          id TEXT PRIMARY KEY,
          doc_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          name TEXT NOT NULL,
          cells_json TEXT NOT NULL,
          sheets_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          created_by TEXT NOT NULL,
          FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_version_snapshots_doc_id ON version_snapshots(doc_id);
        CREATE INDEX IF NOT EXISTS idx_version_snapshots_doc_version ON version_snapshots(doc_id, version DESC);
      `);
        }
    }
    createSnapshot(docId, name, createdBy) {
        const transaction = this.db.transaction(() => {
            const docRow = this.db
                .prepare('SELECT version FROM documents WHERE id = ?')
                .get(docId);
            if (!docRow) {
                throw new Error(`Document not found: ${docId}`);
            }
            const state = this.reconstructState(docId, docRow.version);
            const id = uuidv4();
            const createdAt = Date.now();
            this.db
                .prepare(`INSERT INTO version_snapshots (id, doc_id, version, name, cells_json, sheets_json, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(id, docId, docRow.version, name, JSON.stringify(state.cells), JSON.stringify(state.sheets), createdAt, createdBy);
            const clock = { 'version-manager': 1 };
            this.eventStore.appendEvent(docId, EventType.SNAPSHOT_CREATED, {
                version: docRow.version,
                snapshotData: { snapshotId: id, name },
                createdAt,
            }, createdBy, clock);
            return {
                id,
                docId,
                version: docRow.version,
                name,
                cells: state.cells,
                sheets: state.sheets,
                createdAt,
                createdBy,
            };
        });
        return transaction();
    }
    getVersionHistory(docId) {
        const rows = this.db
            .prepare(`SELECT id, doc_id, version, name, cells_json, sheets_json, created_at, created_by
         FROM version_snapshots
         WHERE doc_id = ?
         ORDER BY version DESC`)
            .all(docId);
        return rows.map((row) => this.mapStoredSnapshot(row));
    }
    getVersion(docId, versionId) {
        const row = this.db
            .prepare(`SELECT id, doc_id, version, name, cells_json, sheets_json, created_at, created_by
         FROM version_snapshots
         WHERE id = ? AND doc_id = ?`)
            .get(versionId, docId);
        if (!row) {
            throw new Error(`Version snapshot not found: ${versionId}`);
        }
        return this.mapStoredSnapshot(row);
    }
    diffVersions(docId, versionAId, versionBId) {
        const versionA = this.getVersion(docId, versionAId);
        const versionB = this.getVersion(docId, versionBId);
        return this.computeDiff(versionA, versionB);
    }
    rollbackToVersion(docId, targetVersionId, userId) {
        const targetSnapshot = this.getVersion(docId, targetVersionId);
        const currentDocRow = this.db
            .prepare('SELECT version FROM documents WHERE id = ?')
            .get(docId);
        if (!currentDocRow) {
            throw new Error(`Document not found: ${docId}`);
        }
        const currentState = this.reconstructState(docId, currentDocRow.version);
        const diff = this.computeDiffFromStates(currentState, {
            id: docId,
            cells: targetSnapshot.cells,
            sheets: targetSnapshot.sheets,
            version: targetSnapshot.version,
            timestamp: targetSnapshot.createdAt,
        });
        this.applyRollbackEvents(docId, diff, userId, targetSnapshot.version);
    }
    timeTravel(docId, timestamp) {
        const events = this.eventStore.getEventsByTimeRange(docId, 0, timestamp);
        return this.reconstructStateFromEvents(docId, events, timestamp);
    }
    mapStoredSnapshot(row) {
        return {
            id: row.id,
            docId: row.doc_id,
            version: row.version,
            name: row.name,
            cells: JSON.parse(row.cells_json),
            sheets: JSON.parse(row.sheets_json),
            createdAt: row.created_at,
            createdBy: row.created_by,
        };
    }
    reconstructState(docId, targetVersion) {
        const { events } = this.eventStore.replayToVersion(docId, targetVersion);
        return this.reconstructStateFromEvents(docId, events, Date.now());
    }
    reconstructStateFromEvents(docId, events, timestamp) {
        const cells = {};
        const sheets = [];
        let maxSequence = 0;
        for (const event of events) {
            if (event.sequence !== undefined && event.sequence > maxSequence) {
                maxSequence = event.sequence;
            }
            switch (event.eventType) {
                case EventType.SHEET_CREATED: {
                    const payload = event.payload;
                    const existingIndex = sheets.findIndex((s) => s.id === payload.sheetId);
                    const sheet = {
                        id: payload.sheetId,
                        docId,
                        name: payload.name,
                        rowCount: 100,
                        colCount: 26,
                        index: payload.index,
                    };
                    if (existingIndex >= 0) {
                        sheets[existingIndex] = sheet;
                    }
                    else {
                        sheets.push(sheet);
                    }
                    break;
                }
                case EventType.SHEET_UPDATED: {
                    const payload = event.payload;
                    const sheet = sheets.find((s) => s.id === payload.sheetId);
                    if (sheet) {
                        if (payload.name !== undefined)
                            sheet.name = payload.name;
                        if (payload.index !== undefined)
                            sheet.index = payload.index;
                    }
                    break;
                }
                case EventType.SHEET_DELETED: {
                    const payload = event.payload;
                    const idx = sheets.findIndex((s) => s.id === payload.sheetId);
                    if (idx >= 0) {
                        sheets.splice(idx, 1);
                    }
                    break;
                }
                case EventType.CELL_UPDATED: {
                    const payload = event.payload;
                    const existingCell = cells[payload.cellId];
                    const cell = existingCell
                        ? { ...existingCell }
                        : {
                            id: payload.cellId,
                            sheetId: payload.sheetId,
                            row: 0,
                            col: 0,
                            value: null,
                            formula: null,
                            metadata: {},
                        };
                    cell.value = payload.value;
                    cell.metadata = {
                        ...cell.metadata,
                        userId: event.userId,
                        updatedAt: event.timestamp,
                    };
                    cells[payload.cellId] = cell;
                    break;
                }
                case EventType.CELL_FORMULA_UPDATED: {
                    const payload = event.payload;
                    const existingCell = cells[payload.cellId];
                    const cell = existingCell
                        ? { ...existingCell }
                        : {
                            id: payload.cellId,
                            sheetId: payload.sheetId,
                            row: 0,
                            col: 0,
                            value: null,
                            formula: null,
                            metadata: {},
                        };
                    cell.formula = payload.formula;
                    cell.metadata = {
                        ...cell.metadata,
                        userId: event.userId,
                        updatedAt: event.timestamp,
                    };
                    cells[payload.cellId] = cell;
                    break;
                }
                case EventType.CELL_STYLE_UPDATED: {
                    const payload = event.payload;
                    const existingCell = cells[payload.cellId];
                    const cell = existingCell
                        ? { ...existingCell }
                        : {
                            id: payload.cellId,
                            sheetId: payload.sheetId,
                            row: 0,
                            col: 0,
                            value: null,
                            formula: null,
                            metadata: {},
                        };
                    cell.metadata = {
                        ...cell.metadata,
                        style: payload.style,
                        userId: event.userId,
                        updatedAt: event.timestamp,
                    };
                    cells[payload.cellId] = cell;
                    break;
                }
                default:
                    break;
            }
        }
        sheets.sort((a, b) => a.index - b.index);
        return {
            id: docId,
            cells,
            sheets,
            version: maxSequence,
            timestamp,
        };
    }
    computeDiff(versionA, versionB) {
        return this.computeDiffFromStates({
            id: versionA.docId,
            cells: versionA.cells,
            sheets: versionA.sheets,
            version: versionA.version,
            timestamp: versionA.createdAt,
        }, {
            id: versionB.docId,
            cells: versionB.cells,
            sheets: versionB.sheets,
            version: versionB.version,
            timestamp: versionB.createdAt,
        });
    }
    computeDiffFromStates(stateA, stateB) {
        const addedCells = [];
        const modifiedCells = [];
        const deletedCells = [];
        const cellIdsA = Object.keys(stateA.cells);
        const cellIdsB = Object.keys(stateB.cells);
        const cellIdSetA = new Set(cellIdsA);
        const cellIdSetB = new Set(cellIdsB);
        for (const cellId of cellIdsB) {
            if (!cellIdSetA.has(cellId)) {
                addedCells.push(stateB.cells[cellId]);
            }
            else if (!this.cellsEqual(stateA.cells[cellId], stateB.cells[cellId])) {
                modifiedCells.push({
                    cellId,
                    oldValue: stateA.cells[cellId],
                    newValue: stateB.cells[cellId],
                });
            }
        }
        for (const cellId of cellIdsA) {
            if (!cellIdSetB.has(cellId)) {
                deletedCells.push(cellId);
            }
        }
        const addedSheets = [];
        const modifiedSheets = [];
        const deletedSheets = [];
        const sheetMapA = new Map(stateA.sheets.map((s) => [s.id, s]));
        const sheetMapB = new Map(stateB.sheets.map((s) => [s.id, s]));
        for (const sheet of stateB.sheets) {
            if (!sheetMapA.has(sheet.id)) {
                addedSheets.push(sheet);
            }
            else if (!this.sheetsEqual(sheetMapA.get(sheet.id), sheet)) {
                modifiedSheets.push({
                    sheetId: sheet.id,
                    oldSheet: sheetMapA.get(sheet.id),
                    newSheet: sheet,
                });
            }
        }
        for (const sheet of stateA.sheets) {
            if (!sheetMapB.has(sheet.id)) {
                deletedSheets.push(sheet.id);
            }
        }
        return {
            addedCells,
            modifiedCells,
            deletedCells,
            addedSheets,
            modifiedSheets,
            deletedSheets,
        };
    }
    cellsEqual(a, b) {
        return (a.value === b.value &&
            a.formula === b.formula &&
            a.sheetId === b.sheetId &&
            a.row === b.row &&
            a.col === b.col &&
            JSON.stringify(a.metadata) === JSON.stringify(b.metadata));
    }
    sheetsEqual(a, b) {
        return (a.name === b.name &&
            a.index === b.index &&
            a.rowCount === b.rowCount &&
            a.colCount === b.colCount);
    }
    applyRollbackEvents(docId, diff, userId, targetVersion) {
        const transaction = this.db.transaction(() => {
            const clock = { [userId]: Date.now() };
            for (const sheetId of diff.deletedSheets) {
                this.eventStore.appendEvent(docId, EventType.SHEET_DELETED, { sheetId }, userId, clock);
            }
            for (const ms of diff.modifiedSheets) {
                this.eventStore.appendEvent(docId, EventType.SHEET_UPDATED, {
                    sheetId: ms.sheetId,
                    name: ms.oldSheet.name !== ms.newSheet.name ? ms.oldSheet.name : undefined,
                    index: ms.oldSheet.index !== ms.newSheet.index ? ms.oldSheet.index : undefined,
                }, userId, clock);
            }
            for (const sheet of diff.addedSheets) {
                this.eventStore.appendEvent(docId, EventType.SHEET_CREATED, {
                    sheetId: sheet.id,
                    name: sheet.name,
                    index: sheet.index,
                }, userId, clock);
            }
            for (const cellId of diff.deletedCells) {
                this.eventStore.appendEvent(docId, EventType.CELL_UPDATED, {
                    sheetId: '',
                    cellId,
                    value: null,
                }, userId, clock, cellId);
            }
            for (const mc of diff.modifiedCells) {
                if (mc.oldValue.value !== mc.newValue.value) {
                    this.eventStore.appendEvent(docId, EventType.CELL_UPDATED, {
                        sheetId: mc.oldValue.sheetId,
                        cellId: mc.cellId,
                        value: mc.oldValue.value,
                        oldValue: mc.newValue.value,
                    }, userId, clock, mc.cellId);
                }
                if (mc.oldValue.formula !== mc.newValue.formula) {
                    this.eventStore.appendEvent(docId, EventType.CELL_FORMULA_UPDATED, {
                        sheetId: mc.oldValue.sheetId,
                        cellId: mc.cellId,
                        formula: mc.oldValue.formula,
                        oldFormula: mc.newValue.formula,
                    }, userId, clock, mc.cellId);
                }
                if (JSON.stringify(mc.oldValue.metadata.style) !==
                    JSON.stringify(mc.newValue.metadata.style)) {
                    this.eventStore.appendEvent(docId, EventType.CELL_STYLE_UPDATED, {
                        sheetId: mc.oldValue.sheetId,
                        cellId: mc.cellId,
                        style: mc.oldValue.metadata.style || {},
                        oldStyle: mc.newValue.metadata.style,
                    }, userId, clock, mc.cellId);
                }
            }
            for (const cell of diff.addedCells) {
                this.eventStore.appendEvent(docId, EventType.CELL_UPDATED, {
                    sheetId: cell.sheetId,
                    cellId: cell.id,
                    value: cell.value,
                }, userId, clock, cell.id);
                if (cell.formula) {
                    this.eventStore.appendEvent(docId, EventType.CELL_FORMULA_UPDATED, {
                        sheetId: cell.sheetId,
                        cellId: cell.id,
                        formula: cell.formula,
                    }, userId, clock, cell.id);
                }
                if (cell.metadata.style) {
                    this.eventStore.appendEvent(docId, EventType.CELL_STYLE_UPDATED, {
                        sheetId: cell.sheetId,
                        cellId: cell.id,
                        style: cell.metadata.style,
                    }, userId, clock, cell.id);
                }
            }
        });
        transaction();
    }
    close() {
        this.db.close();
        this.eventStore.close();
    }
}
