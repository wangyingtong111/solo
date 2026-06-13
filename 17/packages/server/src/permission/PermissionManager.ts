import type { Cell, CellRange, PermissionRule } from '../types.js';
import type {
  CellPermissionRule,
  DocumentRole,
  DocumentRoleRule,
  PermissionFilterResult,
} from './types.js';
import { v4 as uuidv4 } from 'uuid';

const USER_COLOR_POOL = [
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#96CEB4',
  '#FFEAA7',
  '#DDA0DD',
  '#98D8C8',
  '#F7DC6F',
  '#BB8FCE',
  '#85C1E9',
  '#F8B500',
  '#FF8C42',
];

export class PermissionManager {
  private documentRoles: Map<string, Map<string, DocumentRoleRule>>;
  private cellPermissions: Map<string, CellPermissionRule>;
  private userColors: Map<string, string>;
  private colorIndex: number;

  constructor() {
    this.documentRoles = new Map();
    this.cellPermissions = new Map();
    this.userColors = new Map();
    this.colorIndex = 0;
  }

  grantDocumentRole(
    docId: string,
    userId: string,
    role: DocumentRole,
    grantedBy: string
  ): DocumentRoleRule {
    const now = Date.now();
    const rule: DocumentRoleRule = {
      id: uuidv4(),
      docId,
      userId,
      role,
      grantedAt: now,
      grantedBy,
    };

    if (!this.documentRoles.has(docId)) {
      this.documentRoles.set(docId, new Map());
    }
    this.documentRoles.get(docId)!.set(userId, rule);
    return rule;
  }

  getDocumentRole(docId: string, userId: string): DocumentRole | null {
    const docRoles = this.documentRoles.get(docId);
    if (!docRoles) return null;
    return docRoles.get(userId)?.role ?? null;
  }

  grantPermission(
    docId: string,
    userId: string,
    cellRange: CellRange,
    canRead: boolean,
    canEdit: boolean,
    grantedBy: string
  ): CellPermissionRule {
    const now = Date.now();
    const rule: CellPermissionRule = {
      id: uuidv4(),
      docId,
      userId,
      cellRange,
      canRead,
      canEdit,
      grantedAt: now,
      grantedBy,
    };

    this.cellPermissions.set(rule.id, rule);
    return rule;
  }

  revokePermission(permissionId: string): boolean {
    return this.cellPermissions.delete(permissionId);
  }

  revokeDocumentRole(docId: string, userId: string): boolean {
    const docRoles = this.documentRoles.get(docId);
    if (!docRoles) return false;
    return docRoles.delete(userId);
  }

  checkCanEdit(userId: string, cellId: string, docId?: string): boolean {
    const position = this.parseCellId(cellId);
    if (!position) return false;

    const targetDocId = docId ?? this.findDocIdByCellId(cellId);
    if (targetDocId) {
      const role = this.getDocumentRole(targetDocId, userId);
      if (role === 'owner' || role === 'editor') {
        return true;
      }
    }

    const rules = this.getCellRulesForUser(userId, targetDocId ?? undefined);
    for (const rule of rules) {
      if (rule.canEdit && this.isPositionInRange(position, rule.cellRange)) {
        return true;
      }
    }

    return false;
  }

  checkCanRead(userId: string, cellId: string, docId?: string): boolean {
    const position = this.parseCellId(cellId);
    if (!position) return false;

    const targetDocId = docId ?? this.findDocIdByCellId(cellId);
    if (targetDocId) {
      const role = this.getDocumentRole(targetDocId, userId);
      if (role === 'owner' || role === 'editor' || role === 'viewer') {
        return true;
      }
    }

    const rules = this.getCellRulesForUser(userId, targetDocId ?? undefined);
    for (const rule of rules) {
      if (rule.canRead && this.isPositionInRange(position, rule.cellRange)) {
        return true;
      }
    }

    return false;
  }

  getUserEditableRanges(userId: string, docId: string): CellRange[] {
    const role = this.getDocumentRole(docId, userId);
    if (role === 'owner' || role === 'editor') {
      return [
        {
          sheetId: '*',
          startRow: 1,
          endRow: Infinity,
          startCol: 1,
          endCol: Infinity,
        },
      ];
    }

    const ranges: CellRange[] = [];
    const rules = this.getCellRulesForUser(userId, docId);
    for (const rule of rules) {
      if (rule.canEdit) {
        ranges.push(rule.cellRange);
      }
    }
    return this.mergeRanges(ranges);
  }

  getUserReadableRanges(userId: string, docId: string): CellRange[] {
    const role = this.getDocumentRole(docId, userId);
    if (role === 'owner' || role === 'editor' || role === 'viewer') {
      return [
        {
          sheetId: '*',
          startRow: 1,
          endRow: Infinity,
          startCol: 1,
          endCol: Infinity,
        },
      ];
    }

    const ranges: CellRange[] = [];
    const rules = this.getCellRulesForUser(userId, docId);
    for (const rule of rules) {
      if (rule.canRead) {
        ranges.push(rule.cellRange);
      }
    }
    return this.mergeRanges(ranges);
  }

  getUserColor(userId: string): string {
    if (!this.userColors.has(userId)) {
      const color = USER_COLOR_POOL[this.colorIndex % USER_COLOR_POOL.length];
      this.colorIndex++;
      this.userColors.set(userId, color);
    }
    return this.userColors.get(userId)!;
  }

  filterCellsByPermission(userId: string, cells: Cell[], docId?: string): PermissionFilterResult {
    const allowedCells: Cell[] = [];
    const deniedCells: Cell[] = [];

    for (const cell of cells) {
      if (this.checkCanRead(userId, cell.id, docId)) {
        allowedCells.push(cell);
      } else {
        deniedCells.push(cell);
      }
    }

    return { allowedCells, deniedCells };
  }

  getCellPermissionsForDoc(docId: string): CellPermissionRule[] {
    const result: CellPermissionRule[] = [];
    for (const rule of this.cellPermissions.values()) {
      if (rule.docId === docId) {
        result.push(rule);
      }
    }
    return result;
  }

  getCellPermissionsForUser(userId: string, docId?: string): CellPermissionRule[] {
    const result: CellPermissionRule[] = [];
    for (const rule of this.cellPermissions.values()) {
      if (rule.userId !== userId) continue;
      if (docId && rule.docId !== docId) continue;
      result.push(rule);
    }
    return result;
  }

  toPermissionRules(docId: string): PermissionRule[] {
    const rules: PermissionRule[] = [];

    const docRoles = this.documentRoles.get(docId);
    if (docRoles) {
      for (const roleRule of docRoles.values()) {
        rules.push({
          id: roleRule.id,
          docId: roleRule.docId,
          userId: roleRule.userId,
          cellRange: {
            sheetId: '*',
            startRow: 1,
            endRow: Infinity,
            startCol: 1,
            endCol: Infinity,
          },
          canRead: true,
          canEdit: roleRule.role === 'owner' || roleRule.role === 'editor',
          grantedAt: roleRule.grantedAt,
          grantedBy: roleRule.grantedBy,
        });
      }
    }

    for (const cellRule of this.cellPermissions.values()) {
      if (cellRule.docId === docId) {
        rules.push({
          id: cellRule.id,
          docId: cellRule.docId,
          userId: cellRule.userId,
          cellRange: cellRule.cellRange,
          canRead: cellRule.canRead,
          canEdit: cellRule.canEdit,
          grantedAt: cellRule.grantedAt,
          grantedBy: cellRule.grantedBy,
        });
      }
    }

    return rules;
  }

  private getCellRulesForUser(userId: string, docId?: string): CellPermissionRule[] {
    const result: CellPermissionRule[] = [];
    for (const rule of this.cellPermissions.values()) {
      if (rule.userId !== userId) continue;
      if (docId && rule.docId !== docId) continue;
      result.push(rule);
    }
    return result;
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

  private isPositionInRange(
    position: { sheetId: string; row: number; col: number },
    range: CellRange
  ): boolean {
    if (range.sheetId !== '*' && position.sheetId !== range.sheetId) return false;
    return (
      position.row >= range.startRow &&
      position.row <= range.endRow &&
      position.col >= range.startCol &&
      position.col <= range.endCol
    );
  }

  private findDocIdByCellId(cellId: string): string | null {
    const position = this.parseCellId(cellId);
    if (!position) return null;

    for (const [docId] of this.documentRoles) {
      const rules = this.getCellRulesForUser('', docId);
      for (const rule of rules) {
        if (rule.cellRange.sheetId === position.sheetId) {
          return docId;
        }
      }
    }

    for (const rule of this.cellPermissions.values()) {
      if (rule.cellRange.sheetId === position.sheetId) {
        return rule.docId;
      }
    }

    return null;
  }

  private mergeRanges(ranges: CellRange[]): CellRange[] {
    if (ranges.length <= 1) return ranges;

    const bySheet = new Map<string, CellRange[]>();
    for (const range of ranges) {
      const key = range.sheetId;
      if (!bySheet.has(key)) {
        bySheet.set(key, []);
      }
      bySheet.get(key)!.push(range);
    }

    const result: CellRange[] = [];
    for (const [sheetId, sheetRanges] of bySheet) {
      const sorted = sheetRanges.sort((a, b) => {
        if (a.startRow !== b.startRow) return a.startRow - b.startRow;
        return a.startCol - b.startCol;
      });

      const merged: CellRange[] = [];
      for (const range of sorted) {
        const last = merged[merged.length - 1];
        if (last && this.canMerge(last, range)) {
          last.endRow = Math.max(last.endRow, range.endRow);
          last.endCol = Math.max(last.endCol, range.endCol);
          last.startRow = Math.min(last.startRow, range.startRow);
          last.startCol = Math.min(last.startCol, range.startCol);
        } else {
          merged.push({ ...range });
        }
      }
      result.push(...merged);
    }

    return result;
  }

  private canMerge(a: CellRange, b: CellRange): boolean {
    if (a.sheetId !== b.sheetId) return false;
    return (
      a.startRow <= b.endRow + 1 &&
      a.endRow >= b.startRow - 1 &&
      a.startCol <= b.endCol + 1 &&
      a.endCol >= b.startCol - 1
    );
  }
}
