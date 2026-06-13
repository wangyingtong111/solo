import { EventStore } from './eventStore/EventStore.js';
import { EventType } from './eventStore/types.js';
import type {
  Document,
  Sheet,
  Permission,
  CellUpdatedPayload,
  CellFormulaUpdatedPayload,
  PermissionGrantedPayload,
  PermissionRevokedPayload,
  DocumentCreatedPayload,
  SheetCreatedPayload,
  Event,
} from './eventStore/types.js';
import { FormulaEngine } from './formulaEngine/FormulaEngine.js';
import type { FunctionArgument, CellChangeResult } from './formulaEngine/types.js';
import type {
  DocumentMeta,
  Cell,
  SheetMeta,
  CellRange,
  PermissionRule,
  VersionSnapshot,
  VersionDiff,
  CellPosition,
} from './types.js';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';

type DocState = {
  document: Document | null;
  sheets: Map<string, Sheet>;
  cells: Map<string, Cell>;
  permissions: Map<string, Permission>;
  formulaEngine: FormulaEngine;
};

export class DocumentManager {
  private eventStore: EventStore;
  private db: Database.Database;
  private docStates: Map<string, DocState>;

  constructor(dbPath: string = ':memory:') {
    this.eventStore = new EventStore(dbPath);
    this.db = new Database(dbPath);
    this.docStates = new Map();
  }

  private ensureDocState(docId: string): DocState {
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

  private loadDocState(docId: string): void {
    const state = this.ensureDocState(docId);

    const docRow = this.db
      .prepare('SELECT * FROM documents WHERE id = ?')
      .get(docId) as Document | undefined;
    if (docRow) {
      state.document = docRow;
    }

    const sheetRows = this.db
      .prepare('SELECT * FROM sheets WHERE doc_id = ? ORDER BY "index" ASC')
      .all(docId) as Sheet[];
    for (const sheet of sheetRows) {
      state.sheets.set(sheet.id, sheet);
    }

    const permRows = this.db
      .prepare('SELECT * FROM permissions WHERE doc_id = ? AND revoked_at IS NULL')
      .all(docId) as Permission[];
    for (const perm of permRows) {
      state.permissions.set(perm.userId, perm);
    }
  }

  createDocument(name: string, ownerId: string): DocumentMeta {
    const docId = uuidv4();
    const now = Date.now();

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO documents (id, title, owner_id, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(docId, name, ownerId, now, now, 0);

      const sheetId = uuidv4();
      this.db
        .prepare(
          'INSERT INTO sheets (id, doc_id, name, "index", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(sheetId, docId, 'Sheet1', 0, now, now);

      const permId = uuidv4();
      this.db
        .prepare(
          'INSERT INTO permissions (id, doc_id, user_id, role, granted_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(permId, docId, ownerId, 'owner', now);
    });

    transaction();

    const payload: DocumentCreatedPayload = { title: name, ownerId, createdAt: now };
    this.eventStore.appendEvent(docId, EventType.DOCUMENT_CREATED, payload, ownerId, { [ownerId]: 1 });

    const sheetPayload: SheetCreatedPayload = { sheetId: this.getDefaultSheetId(docId) || uuidv4(), name: 'Sheet1', index: 0 };
    this.eventStore.appendEvent(docId, EventType.SHEET_CREATED, sheetPayload, ownerId, { [ownerId]: 1 });

    const state = this.ensureDocState(docId);
    this.loadDocState(docId);

    return this.toDocumentMeta(state.document!);
  }

  private getDefaultSheetId(docId: string): string | null {
    const row = this.db
      .prepare('SELECT id FROM sheets WHERE doc_id = ? ORDER BY "index" ASC LIMIT 1')
      .get(docId) as { id: string } | undefined;
    return row?.id || null;
  }

  getDocumentMeta(docId: string): DocumentMeta | null {
    const state = this.ensureDocState(docId);
    if (!state.document) return null;
    return this.toDocumentMeta(state.document);
  }

  private toDocumentMeta(doc: Document): DocumentMeta {
    return {
      id: doc.id,
      name: doc.title,
      ownerId: doc.ownerId,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  getSheetMeta(docId: string): SheetMeta[] {
    const state = this.ensureDocState(docId);
    const result: SheetMeta[] = [];
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

  getCell(
    docId: string,
    sheetId: string,
    row: number,
    col: number
  ): Cell | null {
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

  getCells(docId: string, sheetId: string, userId?: string): Cell[] {
    const state = this.ensureDocState(docId);
    const allCells: Cell[] = [];

    for (const cell of state.cells.values()) {
      if (cell.sheetId === sheetId) {
        allCells.push(cell);
      }
    }

    if (!userId) return allCells;

    return this.filterCellsByPermission(docId, userId, allCells);
  }

  private filterCellsByPermission(docId: string, userId: string, cells: Cell[]): Cell[] {
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

  private hasReadPermissionForCell(docId: string, userId: string, cell: Cell): boolean {
    const rules = this.getPermissionRules(docId);
    for (const rule of rules) {
      if (rule.userId !== userId) continue;
      if (!rule.canRead) continue;
      if (this.isCellInRange(cell, rule.cellRange)) {
        return true;
      }
    }
    return false;
  }

  private isCellInRange(cell: Cell, range: CellRange): boolean {
    if (cell.sheetId !== range.sheetId) return false;
    return (
      cell.row >= range.startRow &&
      cell.row <= range.endRow &&
      cell.col >= range.startCol &&
      cell.col <= range.endCol
    );
  }

  updateCell(
    docId: string,
    sheetId: string,
    row: number,
    col: number,
    value: string | number | boolean | null,
    userId: string
  ): { cell: Cell; updatedCells: string[] } {
    const state = this.ensureDocState(docId);

    if (!this.canEdit(docId, userId, sheetId, row, col)) {
      throw new Error('Permission denied');
    }

    const cellId = this.buildCellId(sheetId, row, col);
    const existingCell = state.cells.get(cellId);
    const oldValue = existingCell?.value ?? null;

    const payload: CellUpdatedPayload = { sheetId, cellId, value, oldValue };
    this.eventStore.appendEvent(docId, EventType.CELL_UPDATED, payload, userId, { [userId]: 1 }, cellId);

    const newCell: Cell = {
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
    let result: CellChangeResult;
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || value === null) {
      result = state.formulaEngine.onCellChange(engineCellId, value as FunctionArgument);
    } else {
      result = { updatedCells: [], errors: new Map() };
    }

    for (const dependentCellId of result.updatedCells) {
      const pos = this.parseEngineCellId(dependentCellId);
      if (pos) {
        const depCellId = this.buildCellId(pos.sheetId, pos.row, pos.col);
        const depCell = state.cells.get(depCellId);
        const depValue = state.formulaEngine.getCellValue(dependentCellId);
        if (depCell) {
          depCell.value = depValue as Cell['value'];
          depCell.metadata.updatedAt = Date.now();
        }
      }
    }

    return { cell: newCell, updatedCells: result.updatedCells };
  }

  updateCellFormula(
    docId: string,
    sheetId: string,
    row: number,
    col: number,
    formula: string | null,
    userId: string
  ): { cell: Cell; updatedCells: string[] } {
    const state = this.ensureDocState(docId);

    if (!this.canEdit(docId, userId, sheetId, row, col)) {
      throw new Error('Permission denied');
    }

    const cellId = this.buildCellId(sheetId, row, col);
    const existingCell = state.cells.get(cellId);
    const oldFormula = existingCell?.formula ?? null;

    const payload: CellFormulaUpdatedPayload = { sheetId, cellId, formula, oldFormula };
    this.eventStore.appendEvent(docId, EventType.CELL_FORMULA_UPDATED, payload, userId, { [userId]: 1 }, cellId);

    const engineCellId = this.toEngineCellId(sheetId, row, col);
    let evaluatedValue: FunctionArgument = null;
    let updatedCells: string[] = [];

    if (formula) {
      const evalResult = state.formulaEngine.parseAndEvaluate(formula, engineCellId);
      evaluatedValue = evalResult.value;
      if (evalResult.dependencies.length > 0) {
        updatedCells = state.formulaEngine.onCellChange(engineCellId, evaluatedValue).updatedCells;
      }
    } else {
      state.formulaEngine.removeCell(engineCellId);
    }

    const newCell: Cell = {
      id: cellId,
      sheetId,
      row,
      col,
      value: evaluatedValue as Cell['value'],
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
          depCell.value = depValue as Cell['value'];
          depCell.metadata.updatedAt = Date.now();
        }
      }
    }

    return { cell: newCell, updatedCells };
  }

  private buildCellId(sheetId: string, row: number, col: number): string {
    return `${sheetId}!${this.colToLetter(col)}${row}`;
  }

  private toEngineCellId(sheetId: string, row: number, col: number): string {
    return `${sheetId}!${this.colToLetter(col)}${row}`;
  }

  private parseEngineCellId(engineCellId: string): { sheetId: string; row: number; col: number } | null {
    const match = engineCellId.match(/^(.+)!([A-Z]+)(\d+)$/);
    if (!match) return null;
    return {
      sheetId: match[1],
      col: this.letterToCol(match[2]),
      row: parseInt(match[3], 10),
    };
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

  private letterToCol(letters: string): number {
    let result = 0;
    for (let i = 0; i < letters.length; i++) {
      result = result * 26 + (letters.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
    }
    return result;
  }

  canEdit(docId: string, userId: string, sheetId: string, row: number, col: number): boolean {
    const state = this.ensureDocState(docId);
    const perm = state.permissions.get(userId);
    if (perm && (perm.role === 'owner' || perm.role === 'editor')) {
      return true;
    }
    const cell: Cell = {
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

  private hasEditPermissionForCell(docId: string, userId: string, cell: Cell): boolean {
    const rules = this.getPermissionRules(docId);
    for (const rule of rules) {
      if (rule.userId !== userId) continue;
      if (!rule.canEdit) continue;
      if (this.isCellInRange(cell, rule.cellRange)) {
        return true;
      }
    }
    return false;
  }

  getPermissions(docId: string): Permission[] {
    const rows = this.db
      .prepare('SELECT * FROM permissions WHERE doc_id = ? AND revoked_at IS NULL')
      .all(docId) as Permission[];
    return rows;
  }

  getPermissionRules(docId: string): PermissionRule[] {
    const perms = this.getPermissions(docId);
    const rules: PermissionRule[] = [];
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

  setPermission(
    docId: string,
    userId: string,
    role: 'owner' | 'editor' | 'viewer',
    grantedBy: string
  ): Permission {
    const state = this.ensureDocState(docId);
    const now = Date.now();

    const transaction = this.db.transaction(() => {
      this.db
        .prepare('UPDATE permissions SET revoked_at = ? WHERE doc_id = ? AND user_id = ? AND revoked_at IS NULL')
        .run(now, docId, userId);

      const permId = uuidv4();
      this.db
        .prepare(
          'INSERT INTO permissions (id, doc_id, user_id, role, granted_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(permId, docId, userId, role, now);

      return permId;
    });

    const permId = transaction();

    const payload: PermissionGrantedPayload = { userId, role, grantedAt: now };
    this.eventStore.appendEvent(docId, EventType.PERMISSION_GRANTED, payload, grantedBy, { [grantedBy]: 1 });

    const permission: Permission = {
      id: permId,
      docId,
      userId,
      role,
      grantedAt: now,
    };

    state.permissions.set(userId, permission);
    return permission;
  }

  revokePermission(docId: string, userId: string, revokedBy: string): void {
    const state = this.ensureDocState(docId);
    const now = Date.now();

    this.db
      .prepare('UPDATE permissions SET revoked_at = ? WHERE doc_id = ? AND user_id = ? AND revoked_at IS NULL')
      .run(now, docId, userId);

    const payload: PermissionRevokedPayload = { userId, revokedAt: now, revokedBy };
    this.eventStore.appendEvent(docId, EventType.PERMISSION_REVOKED, payload, revokedBy, { [revokedBy]: 1 });

    state.permissions.delete(userId);
  }

  getVersionHistory(docId: string): Array<{ version: number; timestamp: number; userId: string }> {
    const rows = this.db
      .prepare(
        'SELECT sequence as version, timestamp, user_id as userId FROM events WHERE doc_id = ? ORDER BY sequence ASC'
      )
      .all(docId) as Array<{ version: number; timestamp: number; userId: string }>;
    return rows;
  }

  getVersion(docId: string, versionId: number): VersionSnapshot | null {
    const { document, events } = this.eventStore.replayToVersion(docId, versionId);
    if (!document) return null;

    const state = this.ensureDocState(docId);
    const cells: Record<string, Cell> = {};
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

  getDiff(docId: string, fromVersion: number, toVersion: number): VersionDiff {
    const fromSnapshot = this.getVersion(docId, fromVersion);
    const toSnapshot = this.getVersion(docId, toVersion);

    const diff: VersionDiff = {
      addedCells: [],
      modifiedCells: [],
      deletedCells: [],
      addedSheets: [],
      modifiedSheets: [],
      deletedSheets: [],
    };

    if (!fromSnapshot || !toSnapshot) return diff;

    const fromCellIds = new Set(Object.keys(fromSnapshot.cells));
    const toCellIds = new Set(Object.keys(toSnapshot.cells));

    for (const cellId of toCellIds) {
      if (!fromCellIds.has(cellId)) {
        diff.addedCells.push(toSnapshot.cells[cellId]);
      } else {
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
      } else {
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

  rollbackToVersion(docId: string, versionId: number, userId: string): boolean {
    const snapshot = this.getVersion(docId, versionId);
    if (!snapshot) return false;

    const state = this.ensureDocState(docId);
    state.cells.clear();

    for (const [cellId, cell] of Object.entries(snapshot.cells)) {
      state.cells.set(cellId, { ...cell });
    }

    return true;
  }

  getEventStore(): EventStore {
    return this.eventStore;
  }

  close(): void {
    this.eventStore.close();
    this.db.close();
  }
}
