import { EventStore } from './eventStore/EventStore.js';
import { EventType } from './eventStore/types.js';
import { FormulaEngine } from './formulaEngine/FormulaEngine.js';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
export class DocumentManager {
    eventStore;
    db;
    docStates;
    constructor(dbPath = ':memory:') {
        this.eventStore = new EventStore(dbPath);
        this.db = new Database(dbPath);
        this.docStates = new Map();
    }
    ensureDocState(docId) {
        let state = this.docStates.get(docId);
        if (!state) {
            state = {
                document: null,
                sheets: new Map(),
                cells: new Map(),
                permissions: new Map(),
                formulaEngine: new FormulaEngine(),
            };
            this.docStates.set(docId, state);
            this.loadDocState(docId);
        }
        return state;
    }
    loadDocState(docId) {
        const state = this.ensureDocState(docId);
        const docRow = this.db
            .prepare('SELECT * FROM documents WHERE id = ?')
            .get(docId);
        if (docRow) {
            state.document = docRow;
        }
        const sheetRows = this.db
            .prepare('SELECT * FROM sheets WHERE doc_id = ? ORDER BY "index" ASC')
            .all(docId);
        for (const sheet of sheetRows) {
            state.sheets.set(sheet.id, sheet);
        }
        const permRows = this.db
            .prepare('SELECT * FROM permissions WHERE doc_id = ? AND revoked_at IS NULL')
            .all(docId);
        for (const perm of permRows) {
            state.permissions.set(perm.userId, perm);
        }
    }
    createDocument(name, ownerId) {
        const docId = uuidv4();
        const now = Date.now();
        const transaction = this.db.transaction(() => {
            this.db
                .prepare('INSERT INTO documents (id, title, owner_id, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?)')
                .run(docId, name, ownerId, now, now, 0);
            const sheetId = uuidv4();
            this.db
                .prepare('INSERT INTO sheets (id, doc_id, name, "index", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
                .run(sheetId, docId, 'Sheet1', 0, now, now);
            const permId = uuidv4();
            this.db
                .prepare('INSERT INTO permissions (id, doc_id, user_id, role, granted_at) VALUES (?, ?, ?, ?, ?)')
                .run(permId, docId, ownerId, 'owner', now);
        });
        transaction();
        const payload = { title: name, ownerId, createdAt: now };
        this.eventStore.appendEvent(docId, EventType.DOCUMENT_CREATED, payload, ownerId, { [ownerId]: 1 });
        const sheetPayload = { sheetId: this.getDefaultSheetId(docId) || uuidv4(), name: 'Sheet1', index: 0 };
        this.eventStore.appendEvent(docId, EventType.SHEET_CREATED, sheetPayload, ownerId, { [ownerId]: 1 });
        const state = this.ensureDocState(docId);
        this.loadDocState(docId);
        return this.toDocumentMeta(state.document);
    }
    getDefaultSheetId(docId) {
        const row = this.db
            .prepare('SELECT id FROM sheets WHERE doc_id = ? ORDER BY "index" ASC LIMIT 1')
            .get(docId);
        return row?.id || null;
    }
    getDocumentMeta(docId) {
        const state = this.ensureDocState(docId);
        if (!state.document)
            return null;
        return this.toDocumentMeta(state.document);
    }
    toDocumentMeta(doc) {
        return {
            id: doc.id,
            name: doc.title,
            ownerId: doc.ownerId,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
        };
    }
    getSheetMeta(docId) {
        const state = this.ensureDocState(docId);
        const result = [];
        for (const sheet of state.sheets.values()) {
            result.push({
                id: sheet.id,
                docId: sheet.docId,
                name: sheet.name,
                rowCount: 100,
                colCount: 26,
                index: sheet.index,
            });
        }
        return result.sort((a, b) => a.index - b.index);
    }
    getCell(docId, sheetId, row, col) {
        const state = this.ensureDocState(docId);
        const cellId = this.buildCellId(sheetId, row, col);
        const cell = state.cells.get(cellId);
        if (!cell) {
            return {
                id: cellId,
                sheetId,
                row,
                col,
                value: null,
                formula: null,
                metadata: {},
            };
        }
        return cell;
    }
    getCells(docId, sheetId, userId) {
        const state = this.ensureDocState(docId);
        const allCells = [];
        for (const cell of state.cells.values()) {
            if (cell.sheetId === sheetId) {
                allCells.push(cell);
            }
        }
        if (!userId)
            return allCells;
        return this.filterCellsByPermission(docId, userId, allCells);
    }
    filterCellsByPermission(docId, userId, cells) {
        const permissions = this.getPermissions(docId);
        const userPerm = permissions.find((p) => p.userId === userId);
        if (userPerm && (userPerm.role === 'owner' || userPerm.role === 'editor')) {
            return cells;
        }
        if (userPerm && userPerm.role === 'viewer') {
            return cells;
        }
        return cells.filter((cell) => {
            return this.hasReadPermissionForCell(docId, userId, cell);
        });
    }
    hasReadPermissionForCell(docId, userId, cell) {
        const rules = this.getPermissionRules(docId);
        for (const rule of rules) {
            if (rule.userId !== userId)
                continue;
            if (!rule.canRead)
                continue;
            if (this.isCellInRange(cell, rule.cellRange)) {
                return true;
            }
        }
        return false;
    }
    isCellInRange(cell, range) {
        if (cell.sheetId !== range.sheetId)
            return false;
        return (cell.row >= range.startRow &&
            cell.row <= range.endRow &&
            cell.col >= range.startCol &&
            cell.col <= range.endCol);
    }
    updateCell(docId, sheetId, row, col, value, userId) {
        const state = this.ensureDocState(docId);
        if (!this.canEdit(docId, userId, sheetId, row, col)) {
            throw new Error('Permission denied');
        }
        const cellId = this.buildCellId(sheetId, row, col);
        const existingCell = state.cells.get(cellId);
        const oldValue = existingCell?.value ?? null;
        const payload = { sheetId, cellId, value, oldValue };
        this.eventStore.appendEvent(docId, EventType.CELL_UPDATED, payload, userId, { [userId]: 1 }, cellId);
        const newCell = {
            id: cellId,
            sheetId,
            row,
            col,
            value,
            formula: existingCell?.formula ?? null,
            metadata: {
                ...existingCell?.metadata,
                userId,
                updatedAt: Date.now(),
            },
        };
        state.cells.set(cellId, newCell);
        const engineCellId = this.toEngineCellId(sheetId, row, col);
        let result;
        if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || value === null) {
            result = state.formulaEngine.onCellChange(engineCellId, value);
        }
        else {
            result = { updatedCells: [], errors: new Map() };
        }
        for (const dependentCellId of result.updatedCells) {
            const pos = this.parseEngineCellId(dependentCellId);
            if (pos) {
                const depCellId = this.buildCellId(pos.sheetId, pos.row, pos.col);
                const depCell = state.cells.get(depCellId);
                const depValue = state.formulaEngine.getCellValue(dependentCellId);
                if (depCell) {
                    depCell.value = depValue;
                    depCell.metadata.updatedAt = Date.now();
                }
            }
        }
        return { cell: newCell, updatedCells: result.updatedCells };
    }
    updateCellFormula(docId, sheetId, row, col, formula, userId) {
        const state = this.ensureDocState(docId);
        if (!this.canEdit(docId, userId, sheetId, row, col)) {
            throw new Error('Permission denied');
        }
        const cellId = this.buildCellId(sheetId, row, col);
        const existingCell = state.cells.get(cellId);
        const oldFormula = existingCell?.formula ?? null;
        const payload = { sheetId, cellId, formula, oldFormula };
        this.eventStore.appendEvent(docId, EventType.CELL_FORMULA_UPDATED, payload, userId, { [userId]: 1 }, cellId);
        const engineCellId = this.toEngineCellId(sheetId, row, col);
        let evaluatedValue = null;
        let updatedCells = [];
        if (formula) {
            const evalResult = state.formulaEngine.parseAndEvaluate(formula, engineCellId);
            evaluatedValue = evalResult.value;
            if (evalResult.dependencies.length > 0) {
                updatedCells = state.formulaEngine.onCellChange(engineCellId, evaluatedValue).updatedCells;
            }
        }
        else {
            state.formulaEngine.removeCell(engineCellId);
        }
        const newCell = {
            id: cellId,
            sheetId,
            row,
            col,
            value: evaluatedValue,
            formula,
            metadata: {
                ...existingCell?.metadata,
                userId,
                updatedAt: Date.now(),
            },
        };
        state.cells.set(cellId, newCell);
        for (const dependentCellId of updatedCells) {
            const pos = this.parseEngineCellId(dependentCellId);
            if (pos) {
                const depCellId = this.buildCellId(pos.sheetId, pos.row, pos.col);
                const depCell = state.cells.get(depCellId);
                const depValue = state.formulaEngine.getCellValue(dependentCellId);
                if (depCell) {
                    depCell.value = depValue;
                    depCell.metadata.updatedAt = Date.now();
                }
            }
        }
        return { cell: newCell, updatedCells };
    }
    buildCellId(sheetId, row, col) {
        return `${sheetId}!${this.colToLetter(col)}${row}`;
    }
    toEngineCellId(sheetId, row, col) {
        return `${sheetId}!${this.colToLetter(col)}${row}`;
    }
    parseEngineCellId(engineCellId) {
        const match = engineCellId.match(/^(.+)!([A-Z]+)(\d+)$/);
        if (!match)
            return null;
        return {
            sheetId: match[1],
            col: this.letterToCol(match[2]),
            row: parseInt(match[3], 10),
        };
    }
    colToLetter(col) {
        let result = '';
        let remaining = col;
        while (remaining > 0) {
            const mod = (remaining - 1) % 26;
            result = String.fromCharCode('A'.charCodeAt(0) + mod) + result;
            remaining = Math.floor((remaining - 1) / 26);
        }
        return result || 'A';
    }
    letterToCol(letters) {
        let result = 0;
        for (let i = 0; i < letters.length; i++) {
            result = result * 26 + (letters.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
        }
        return result;
    }
    canEdit(docId, userId, sheetId, row, col) {
        const state = this.ensureDocState(docId);
        const perm = state.permissions.get(userId);
        if (perm && (perm.role === 'owner' || perm.role === 'editor')) {
            return true;
        }
        const cell = {
            id: this.buildCellId(sheetId, row, col),
            sheetId,
            row,
            col,
            value: null,
            formula: null,
            metadata: {},
        };
        return this.hasEditPermissionForCell(docId, userId, cell);
    }
    hasEditPermissionForCell(docId, userId, cell) {
        const rules = this.getPermissionRules(docId);
        for (const rule of rules) {
            if (rule.userId !== userId)
                continue;
            if (!rule.canEdit)
                continue;
            if (this.isCellInRange(cell, rule.cellRange)) {
                return true;
            }
        }
        return false;
    }
    getPermissions(docId) {
        const rows = this.db
            .prepare('SELECT * FROM permissions WHERE doc_id = ? AND revoked_at IS NULL')
            .all(docId);
        return rows;
    }
    getPermissionRules(docId) {
        const perms = this.getPermissions(docId);
        const rules = [];
        for (const perm of perms) {
            rules.push({
                id: perm.id,
                docId: perm.docId,
                userId: perm.userId,
                cellRange: {
                    sheetId: this.getDefaultSheetId(perm.docId) || '',
                    startRow: 1,
                    endRow: 9999,
                    startCol: 1,
                    endCol: 9999,
                },
                canRead: true,
                canEdit: perm.role === 'owner' || perm.role === 'editor',
                grantedAt: perm.grantedAt,
                grantedBy: perm.userId,
            });
        }
        return rules;
    }
    setPermission(docId, userId, role, grantedBy) {
        const state = this.ensureDocState(docId);
        const now = Date.now();
        const transaction = this.db.transaction(() => {
            this.db
                .prepare('UPDATE permissions SET revoked_at = ? WHERE doc_id = ? AND user_id = ? AND revoked_at IS NULL')
                .run(now, docId, userId);
            const permId = uuidv4();
            this.db
                .prepare('INSERT INTO permissions (id, doc_id, user_id, role, granted_at) VALUES (?, ?, ?, ?, ?)')
                .run(permId, docId, userId, role, now);
            return permId;
        });
        const permId = transaction();
        const payload = { userId, role, grantedAt: now };
        this.eventStore.appendEvent(docId, EventType.PERMISSION_GRANTED, payload, grantedBy, { [grantedBy]: 1 });
        const permission = {
            id: permId,
            docId,
            userId,
            role,
            grantedAt: now,
        };
        state.permissions.set(userId, permission);
        return permission;
    }
    revokePermission(docId, userId, revokedBy) {
        const state = this.ensureDocState(docId);
        const now = Date.now();
        this.db
            .prepare('UPDATE permissions SET revoked_at = ? WHERE doc_id = ? AND user_id = ? AND revoked_at IS NULL')
            .run(now, docId, userId);
        const payload = { userId, revokedAt: now, revokedBy };
        this.eventStore.appendEvent(docId, EventType.PERMISSION_REVOKED, payload, revokedBy, { [revokedBy]: 1 });
        state.permissions.delete(userId);
    }
    getVersionHistory(docId) {
        const rows = this.db
            .prepare('SELECT sequence as version, timestamp, user_id as userId FROM events WHERE doc_id = ? ORDER BY sequence ASC')
            .all(docId);
        return rows;
    }
    getVersion(docId, versionId) {
        const { document, events } = this.eventStore.replayToVersion(docId, versionId);
        if (!document)
            return null;
        const state = this.ensureDocState(docId);
        const cells = {};
        for (const [cellId, cell] of state.cells.entries()) {
            cells[cellId] = { ...cell };
        }
        const sheets = this.getSheetMeta(docId);
        const firstEvent = events[0];
        return {
            id: `v${versionId}`,
            docId,
            version: versionId,
            name: `Version ${versionId}`,
            cells,
            sheets,
            createdAt: firstEvent?.timestamp ?? Date.now(),
            createdBy: firstEvent?.userId ?? '',
        };
    }
    getDiff(docId, fromVersion, toVersion) {
        const fromSnapshot = this.getVersion(docId, fromVersion);
        const toSnapshot = this.getVersion(docId, toVersion);
        const diff = {
            addedCells: [],
            modifiedCells: [],
            deletedCells: [],
            addedSheets: [],
            modifiedSheets: [],
            deletedSheets: [],
        };
        if (!fromSnapshot || !toSnapshot)
            return diff;
        const fromCellIds = new Set(Object.keys(fromSnapshot.cells));
        const toCellIds = new Set(Object.keys(toSnapshot.cells));
        for (const cellId of toCellIds) {
            if (!fromCellIds.has(cellId)) {
                diff.addedCells.push(toSnapshot.cells[cellId]);
            }
            else {
                const oldCell = fromSnapshot.cells[cellId];
                const newCell = toSnapshot.cells[cellId];
                if (oldCell.value !== newCell.value || oldCell.formula !== newCell.formula) {
                    diff.modifiedCells.push({ cellId, oldValue: oldCell, newValue: newCell });
                }
            }
        }
        for (const cellId of fromCellIds) {
            if (!toCellIds.has(cellId)) {
                diff.deletedCells.push(cellId);
            }
        }
        const fromSheetIds = new Set(fromSnapshot.sheets.map((s) => s.id));
        const toSheetIds = new Set(toSnapshot.sheets.map((s) => s.id));
        for (const sheet of toSnapshot.sheets) {
            if (!fromSheetIds.has(sheet.id)) {
                diff.addedSheets.push(sheet);
            }
            else {
                const oldSheet = fromSnapshot.sheets.find((s) => s.id === sheet.id);
                if (oldSheet && (oldSheet.name !== sheet.name || oldSheet.index !== sheet.index)) {
                    diff.modifiedSheets.push({ sheetId: sheet.id, oldSheet, newSheet: sheet });
                }
            }
        }
        for (const sheet of fromSnapshot.sheets) {
            if (!toSheetIds.has(sheet.id)) {
                diff.deletedSheets.push(sheet.id);
            }
        }
        return diff;
    }
    rollbackToVersion(docId, versionId, userId) {
        const snapshot = this.getVersion(docId, versionId);
        if (!snapshot)
            return false;
        const state = this.ensureDocState(docId);
        state.cells.clear();
        for (const [cellId, cell] of Object.entries(snapshot.cells)) {
            state.cells.set(cellId, { ...cell });
        }
        return true;
    }
    getEventStore() {
        return this.eventStore;
    }
    close() {
        this.eventStore.close();
        this.db.close();
    }
}
