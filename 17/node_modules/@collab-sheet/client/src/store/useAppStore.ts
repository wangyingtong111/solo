import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  User,
  DocumentMeta,
  SheetMeta,
  Cell,
  CellPosition,
  SelectionRange,
  VersionSnapshot,
  CellRange,
} from '../types';

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

interface PresenceUser {
  user: User;
  online: boolean;
  cursor: CellPosition | null;
  selection: SelectionRange | null;
  clientId: string;
  lastActive: number;
}

export interface AppStoreState {
  currentUser: User | null;
  currentDocId: string | null;
  documentMeta: DocumentMeta | null;
  sheets: SheetMeta[];
  activeSheetId: string | null;
  cells: Record<string, Cell>;
  computedValues: Record<string, string | number | boolean | null>;
  selectedCell: CellPosition | null;
  selection: SelectionRange | null;
  editingCell: CellPosition | null;
  editValue: string;
  presences: PresenceUser[];
  connectionStatus: ConnectionStatus;
  versionHistory: VersionSnapshot[];
  showVersionPanel: boolean;
  showPermissionPanel: boolean;
  editableRanges: CellRange[];
  userColors: Record<string, string>;
  crdtUnsubscribe: (() => void) | null;
}

export interface AppStoreActions {
  setUser: (user: User | null) => void;
  setDocument: (docId: string, meta: DocumentMeta, sheets: SheetMeta[], cells: Record<string, Cell>) => void;
  setActiveSheet: (sheetId: string) => void;
  addSheet: (sheet: SheetMeta) => void;
  updateCell: (cellId: string, cell: Partial<Cell>) => void;
  setComputedValue: (cellId: string, value: string | number | boolean | null) => void;
  selectCell: (pos: CellPosition | null) => void;
  setSelection: (range: SelectionRange | null) => void;
  startEditing: (pos: CellPosition, initialValue?: string) => void;
  setEditValue: (value: string) => void;
  finishEditing: () => void;
  cancelEditing: () => void;
  setPresences: (presences: PresenceUser[]) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setVersionHistory: (versions: VersionSnapshot[]) => void;
  openVersionPanel: () => void;
  closeVersionPanel: () => void;
  openPermissionPanel: () => void;
  closePermissionPanel: () => void;
  setEditableRanges: (ranges: CellRange[]) => void;
  subscribeToCrdt: (unsubscribe: () => void) => void;
  unsubscribeFromCrdt: () => void;
}

export type AppStore = AppStoreState & AppStoreActions;

const USER_COLOR_POOL = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F8B500', '#FF8C42',
];

let colorIndex = 0;

const getUserColor = (userId: string, existingColors: Record<string, string>): string => {
  if (existingColors[userId]) return existingColors[userId];
  const color = USER_COLOR_POOL[colorIndex % USER_COLOR_POOL.length];
  colorIndex++;
  return color;
};

const getCellId = (sheetId: string, row: number, col: number): string =>
  `${sheetId}:${row}:${col}`;

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      currentUser: null,
      currentDocId: null,
      documentMeta: null,
      sheets: [],
      activeSheetId: null,
      cells: {},
      computedValues: {},
      selectedCell: null,
      selection: null,
      editingCell: null,
      editValue: '',
      presences: [],
      connectionStatus: 'disconnected',
      versionHistory: [],
      showVersionPanel: false,
      showPermissionPanel: false,
      editableRanges: [],
      userColors: {},
      crdtUnsubscribe: null,

      setUser: (user) => {
        if (!user) { set({ currentUser: null }); return; }
        const existingColors = get().userColors;
        const color = getUserColor(user.id, existingColors);
        set({
          currentUser: { ...user, color: user.color || color },
          userColors: { ...existingColors, [user.id]: color },
        });
      },

      setDocument: (docId, meta, sheets, cells) => {
        set({
          currentDocId: docId,
          documentMeta: meta,
          sheets,
          activeSheetId: sheets[0]?.id ?? null,
          cells,
          computedValues: {},
          selectedCell: null,
          selection: null,
          editingCell: null,
        });
      },

      setActiveSheet: (sheetId) => {
        set({ activeSheetId: sheetId, selectedCell: null, selection: null, editingCell: null });
      },

      addSheet: (sheet) => {
        set({ sheets: [...get().sheets, sheet] });
      },

      updateCell: (cellId, partial) => {
        const existing = get().cells[cellId];
        if (!existing) {
          set({ cells: { ...get().cells, [cellId]: { id: cellId, sheetId: '', row: 0, col: 0, value: null, formula: null, metadata: {}, ...partial } } });
          return;
        }
        set({ cells: { ...get().cells, [cellId]: { ...existing, ...partial } } });
      },

      setComputedValue: (cellId, value) => {
        set({ computedValues: { ...get().computedValues, [cellId]: value } });
      },

      selectCell: (pos) => {
        if (!pos) {
          set({ selectedCell: null, selection: null, editingCell: null });
          return;
        }
        set({
          selectedCell: pos,
          selection: {
            sheetId: pos.sheetId,
            startRow: pos.row,
            endRow: pos.row,
            startCol: pos.col,
            endCol: pos.col,
          },
          editingCell: null,
          editValue: '',
        });
      },

      setSelection: (range) => {
        set({ selection: range });
      },

      startEditing: (pos, initialValue) => {
        const cellId = getCellId(pos.sheetId, pos.row, pos.col);
        const cell = get().cells[cellId];
        const value = initialValue ?? (cell?.formula ? cell.formula : (cell?.value !== null && cell?.value !== undefined ? String(cell.value) : ''));
        set({ editingCell: pos, editValue: value, selectedCell: pos });
      },

      setEditValue: (value) => {
        set({ editValue: value });
      },

      finishEditing: () => {
        const { editingCell, editValue, cells } = get();
        if (!editingCell) return;
        const cellId = getCellId(editingCell.sheetId, editingCell.row, editingCell.col);
        const existing = cells[cellId];
        const isFormula = editValue.startsWith('=');
        const update: Partial<Cell> = isFormula
          ? { formula: editValue, value: null, sheetId: editingCell.sheetId, row: editingCell.row, col: editingCell.col }
          : { value: editValue === '' ? null : (isNaN(Number(editValue)) ? editValue : Number(editValue)), formula: null, sheetId: editingCell.sheetId, row: editingCell.row, col: editingCell.col };
        const newCells = {
          ...cells,
          [cellId]: existing ? { ...existing, ...update, metadata: { ...existing.metadata, updatedAt: Date.now() } } : { id: cellId, ...update, metadata: { updatedAt: Date.now() } },
        };
        set({ cells: newCells, editingCell: null, editValue: '' });
      },

      cancelEditing: () => {
        set({ editingCell: null, editValue: '' });
      },

      setPresences: (presences) => {
        const existingColors = get().userColors;
        const newColors = { ...existingColors };
        for (const p of presences) {
          if (p.user) {
            const color = getUserColor(p.user.id, newColors);
            newColors[p.user.id] = color;
          }
        }
        set({ presences, userColors: newColors });
      },

      setConnectionStatus: (status) => {
        set({ connectionStatus: status });
      },

      setVersionHistory: (versions) => {
        set({ versionHistory: versions });
      },

      openVersionPanel: () => { set({ showVersionPanel: true }); },
      closeVersionPanel: () => { set({ showVersionPanel: false }); },
      openPermissionPanel: () => { set({ showPermissionPanel: true }); },
      closePermissionPanel: () => { set({ showPermissionPanel: false }); },

      setEditableRanges: (ranges) => {
        set({ editableRanges: ranges });
      },

      subscribeToCrdt: (unsubscribe) => {
        const prev = get().crdtUnsubscribe;
        if (prev) prev();
        set({ crdtUnsubscribe: unsubscribe });
      },

      unsubscribeFromCrdt: () => {
        const prev = get().crdtUnsubscribe;
        if (prev) prev();
        set({ crdtUnsubscribe: null });
      },
    }),
    {
      name: 'collab-sheet-app-store',
      partialize: (state) => ({
        userColors: state.userColors,
      }),
    }
  )
);
