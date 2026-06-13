import React, { useEffect } from 'react';
import { Toolbar } from './components/Toolbar';
import { FormulaBar } from './components/FormulaBar';
import { SpreadsheetGrid } from './components/SpreadsheetGrid';
import { SheetTabs } from './components/SheetTabs';
import { VersionPanel } from './components/VersionPanel';
import { PermissionPanel } from './components/PermissionPanel';
import { useAppStore } from './store/useAppStore';
import { usePermissionStore } from './store/usePermissionStore';
import type { User, SheetMeta, Cell, CellRange, VersionSnapshot } from './types';

const demoUser: User = {
  id: 'user-001',
  name: '我',
  color: '#1a73e8',
  role: 'owner',
};

const demoUsers: User[] = [
  demoUser,
  { id: 'user-002', name: '张三', color: '#34a853', role: 'editor' },
  { id: 'user-003', name: '李四', color: '#fbbc04', role: 'editor' },
  { id: 'user-004', name: '王五', color: '#ea4335', role: 'viewer' },
];

const demoSheets: SheetMeta[] = [
  { id: 'sheet-001', docId: 'doc-demo', name: '销售数据', rowCount: 100, colCount: 26, index: 0 },
  { id: 'sheet-002', docId: 'doc-demo', name: '汇总报表', rowCount: 50, colCount: 20, index: 1 },
];

const createDemoCells = (): Record<string, Cell> => {
  const cells: Record<string, Cell> = {};
  const sheetId = 'sheet-001';

  const headers = ['产品名称', 'Q1销量', 'Q2销量', 'Q3销量', 'Q4销量', '年度总销量', '平均单价', '年度收入'];
  headers.forEach((name, idx) => {
    const cellId = `${sheetId}:0:${idx}`;
    cells[cellId] = {
      id: cellId, sheetId, row: 0, col: idx, value: name, formula: null,
      metadata: { userId: 'user-001', updatedAt: Date.now(), style: { fontWeight: 'bold' } },
    };
  });

  const products = [
    { name: '产品A', q1: 120, q2: 150, q3: 180, q4: 210, price: 99 },
    { name: '产品B', q1: 80, q2: 95, q3: 110, q4: 130, price: 199 },
    { name: '产品C', q1: 200, q2: 180, q3: 220, q4: 250, price: 49 },
    { name: '产品D', q1: 50, q2: 60, q3: 70, q4: 80, price: 499 },
    { name: '产品E', q1: 300, q2: 280, q3: 350, q4: 400, price: 29 },
  ];

  products.forEach((product, rowIdx) => {
    const row = rowIdx + 1;
    const data = [product.name, product.q1, product.q2, product.q3, product.q4];
    data.forEach((val, colIdx) => {
      const cellId = `${sheetId}:${row}:${colIdx}`;
      cells[cellId] = {
        id: cellId, sheetId, row, col: colIdx, value: val, formula: null,
        metadata: { userId: 'user-002', updatedAt: Date.now() - 3600000 },
      };
    });

    const totalCellId = `${sheetId}:${row}:5`;
    cells[totalCellId] = {
      id: totalCellId, sheetId, row, col: 5, value: null,
      formula: `=SUM(B${row + 1}:E${row + 1})`,
      metadata: { userId: 'user-001', updatedAt: Date.now() - 1800000 },
    };

    const priceCellId = `${sheetId}:${row}:6`;
    cells[priceCellId] = {
      id: priceCellId, sheetId, row, col: 6, value: product.price, formula: null,
      metadata: { userId: 'user-001', updatedAt: Date.now() - 1800000 },
    };

    const revenueCellId = `${sheetId}:${row}:7`;
    cells[revenueCellId] = {
      id: revenueCellId, sheetId, row, col: 7, value: null,
      formula: `=F${row + 1}*G${row + 1}`,
      metadata: { userId: 'user-001', updatedAt: Date.now() - 900000 },
    };
  });

  const totalRow = products.length + 1;
  const totalLabelId = `${sheetId}:${totalRow}:0`;
  cells[totalLabelId] = {
    id: totalLabelId, sheetId, row: totalRow, col: 0, value: '合计', formula: null,
    metadata: { userId: 'user-001', updatedAt: Date.now(), style: { fontWeight: 'bold' } },
  };

  for (let col = 1; col <= 7; col++) {
    const cellId = `${sheetId}:${totalRow}:${col}`;
    if (col === 6) {
      cells[cellId] = { id: cellId, sheetId, row: totalRow, col, value: null, formula: null, metadata: {} };
      continue;
    }
    const colLetter = String.fromCharCode(65 + col);
    cells[cellId] = {
      id: cellId, sheetId, row: totalRow, col, value: null,
      formula: `=SUM(${colLetter}2:${colLetter}${totalRow})`,
      metadata: { userId: 'user-001', updatedAt: Date.now(), style: { fontWeight: 'bold' } },
    };
  }

  const sheet2 = 'sheet-002';
  const titleId = `${sheet2}:0:0`;
  cells[titleId] = {
    id: titleId, sheetId: sheet2, row: 0, col: 0, value: '年度销售汇总', formula: null,
    metadata: { userId: 'user-001', updatedAt: Date.now(), style: { fontSize: 16, fontWeight: 'bold' } },
  };
  const refId = `${sheet2}:2:0`;
  cells[refId] = {
    id: refId, sheetId: sheet2, row: 2, col: 0, value: '跨表引用示例:', formula: null,
    metadata: { userId: 'user-001', updatedAt: Date.now() },
  };
  const crossRefId = `${sheet2}:2:1`;
  cells[crossRefId] = {
    id: crossRefId, sheetId: sheet2, row: 2, col: 1, value: null,
    formula: `='销售数据'!H7`,
    metadata: { userId: 'user-001', updatedAt: Date.now() },
  };

  return cells;
};

const demoEditableRanges: CellRange[] = [
  { sheetId: 'sheet-001', startRow: 1, endRow: 5, startCol: 1, endCol: 4 },
  { sheetId: 'sheet-001', startRow: 1, endRow: 5, startCol: 6, endCol: 6 },
];

const demoVersions: VersionSnapshot[] = [
  {
    id: 'ver-003',
    docId: 'doc-demo',
    version: 3,
    name: '最终版 - 提交审核',
    cells: {},
    sheets: demoSheets,
    createdAt: Date.now() - 1000 * 60 * 30,
    createdBy: '我',
  },
  {
    id: 'ver-002',
    docId: 'doc-demo',
    version: 2,
    name: '第二版 - 增加产品D/E',
    cells: {},
    sheets: demoSheets,
    createdAt: Date.now() - 1000 * 60 * 60 * 3,
    createdBy: '张三',
  },
  {
    id: 'ver-001',
    docId: 'doc-demo',
    version: 1,
    name: '初始版本',
    cells: {},
    sheets: demoSheets.slice(0, 1),
    createdAt: Date.now() - 1000 * 60 * 60 * 24,
    createdBy: '我',
  },
];

const demoPresences = [
  {
    user: demoUsers[0],
    online: true,
    cursor: { sheetId: 'sheet-001', row: 2, col: 1 },
    selection: { sheetId: 'sheet-001', startRow: 2, endRow: 2, startCol: 1, endCol: 1 },
    clientId: 'client-001',
    lastActive: Date.now(),
  },
  {
    user: demoUsers[1],
    online: true,
    cursor: { sheetId: 'sheet-001', row: 4, col: 3 },
    selection: { sheetId: 'sheet-001', startRow: 4, endRow: 5, startCol: 2, endCol: 4 },
    clientId: 'client-002',
    lastActive: Date.now() - 30000,
  },
  {
    user: demoUsers[2],
    online: true,
    cursor: { sheetId: 'sheet-002', row: 1, col: 0 },
    selection: { sheetId: 'sheet-002', startRow: 1, endRow: 1, startCol: 0, endCol: 0 },
    clientId: 'client-003',
    lastActive: Date.now() - 60000,
  },
  {
    user: demoUsers[3],
    online: false,
    cursor: null,
    selection: null,
    clientId: 'client-004',
    lastActive: Date.now() - 7200000,
  },
];

export const App: React.FC = () => {
  const {
    setUser, setDocument, setActiveSheet, showVersionPanel, showPermissionPanel,
    setPresences, setConnectionStatus, setVersionHistory, setEditableRanges,
  } = useAppStore();

  const { setUser: setPermUser, setDocument: setPermDoc, setAllUsers, setEditableRanges: setPermEditableRanges } = usePermissionStore();

  useEffect(() => {
    const cells = createDemoCells();

    setUser(demoUser);
    setPermUser(demoUser.id, demoUser);
    setDocument('doc-demo', {
      id: 'doc-demo',
      name: '2024年度销售数据统计',
      ownerId: 'user-001',
      createdAt: Date.now() - 86400000,
      updatedAt: Date.now(),
    }, demoSheets, cells);
    setPermDoc('doc-demo');
    setActiveSheet('sheet-001');
    setAllUsers(demoUsers);
    setPresences(demoPresences as any);
    setConnectionStatus('connected');
    setVersionHistory(demoVersions);
    setEditableRanges(demoEditableRanges);
    setPermEditableRanges(demoEditableRanges);
  }, [setUser, setDocument, setPermUser, setPermDoc, setActiveSheet, setAllUsers, setPresences, setConnectionStatus, setVersionHistory, setEditableRanges, setPermEditableRanges]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw' }}>
      <Toolbar />
      <FormulaBar />
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <SpreadsheetGrid />
      </div>
      <SheetTabs />
      {showVersionPanel && <VersionPanel />}
      {showPermissionPanel && <PermissionPanel />}
    </div>
  );
};
