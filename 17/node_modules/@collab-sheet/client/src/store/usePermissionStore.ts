import { create } from 'zustand';
import type { CellRange, PermissionRule, User } from '../types';

export interface PermissionStoreState {
  userId: string | null;
  docId: string | null;
  editableRanges: CellRange[];
  readableRanges: CellRange[];
  rules: PermissionRule[];
  currentUser: User | null;
  allUsers: User[];
}

export interface PermissionStoreActions {
  setUser: (userId: string | null, user?: User | null) => void;
  setDocument: (docId: string | null) => void;
  setRules: (rules: PermissionRule[]) => void;
  setEditableRanges: (ranges: CellRange[]) => void;
  setReadableRanges: (ranges: CellRange[]) => void;
  setAllUsers: (users: User[]) => void;
  canEdit: (cellId: string) => boolean;
  canRead: (cellId: string) => boolean;
  canEditCell: (sheetId: string, row: number, col: number) => boolean;
  getCellHighlight: (cellId: string) => string | null;
  reset: () => void;
}

export type PermissionStore = PermissionStoreState & PermissionStoreActions;

const isPositionInRange = (
  sheetId: string,
  row: number,
  col: number,
  range: CellRange
): boolean => {
  if (range.sheetId !== '*' && sheetId !== range.sheetId) return false;
  return (
    row >= range.startRow &&
    row <= range.endRow &&
    col >= range.startCol &&
    col <= range.endCol
  );
};

export const usePermissionStore = create<PermissionStore>((set, get) => ({
  userId: null,
  docId: null,
  editableRanges: [],
  readableRanges: [],
  rules: [],
  currentUser: null,
  allUsers: [],

  setUser: (userId, user) => {
    set({ userId, currentUser: user ?? null });
  },

  setDocument: (docId) => {
    set({ docId });
  },

  setRules: (rules) => {
    const state = get();
    const userId = state.userId;
    const docId = state.docId;

    const editableRanges: CellRange[] = [];
    const readableRanges: CellRange[] = [];

    for (const rule of rules) {
      if (userId && rule.userId !== userId) continue;
      if (docId && rule.docId !== docId) continue;
      if (rule.canEdit) {
        editableRanges.push(rule.cellRange);
      }
      if (rule.canRead) {
        readableRanges.push(rule.cellRange);
      }
    }

    set({ rules, editableRanges, readableRanges });
  },

  setEditableRanges: (ranges) => {
    set({ editableRanges: ranges });
  },

  setReadableRanges: (ranges) => {
    set({ readableRanges: ranges });
  },

  setAllUsers: (users) => {
    set({ allUsers: users });
  },

  canEdit: (cellId) => {
    const state = get();
    const match = cellId.match(/^(.+):(\d+):(\d+)$/);
    if (!match) return false;
    const sheetId = match[1];
    const row = parseInt(match[2], 10);
    const col = parseInt(match[3], 10);
    for (const range of state.editableRanges) {
      if (isPositionInRange(sheetId, row, col, range)) return true;
    }
    return false;
  },

  canRead: (cellId) => {
    const state = get();
    const match = cellId.match(/^(.+):(\d+):(\d+)$/);
    if (!match) return false;
    const sheetId = match[1];
    const row = parseInt(match[2], 10);
    const col = parseInt(match[3], 10);
    for (const range of state.readableRanges) {
      if (isPositionInRange(sheetId, row, col, range)) return true;
    }
    return false;
  },

  canEditCell: (sheetId, row, col) => {
    const state = get();
    for (const range of state.editableRanges) {
      if (isPositionInRange(sheetId, row, col, range)) return true;
    }
    return true;
  },

  getCellHighlight: (cellId) => {
    const state = get();
    const match = cellId.match(/^(.+):(\d+):(\d+)$/);
    if (!match) return null;
    const sheetId = match[1];
    const row = parseInt(match[2], 10);
    const col = parseInt(match[3], 10);

    const canEdit = state.editableRanges.some((range) =>
      isPositionInRange(sheetId, row, col, range)
    );
    if (canEdit) return 'rgba(34, 197, 94, 0.15)';

    const canRead = state.readableRanges.some((range) =>
      isPositionInRange(sheetId, row, col, range)
    );
    if (canRead) return null;

    return 'rgba(239, 68, 68, 0.1)';
  },

  reset: () => {
    set({ userId: null, docId: null, editableRanges: [], readableRanges: [], rules: [], currentUser: null, allUsers: [] });
  },
}));
