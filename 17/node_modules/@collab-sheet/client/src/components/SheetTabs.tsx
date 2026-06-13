import React from 'react';
import { useAppStore } from '../store/useAppStore';
import type { SheetMeta } from '../types';

export const SheetTabs: React.FC = () => {
  const { sheets, activeSheetId, setActiveSheet, addSheet } = useAppStore();

  const handleAddSheet = () => {
    const newSheet: SheetMeta = {
      id: `sheet-${Date.now()}`,
      docId: 'demo-doc',
      name: `工作表 ${sheets.length + 1}`,
      rowCount: 100,
      colCount: 26,
      index: sheets.length,
    };
    addSheet(newSheet);
    setActiveSheet(newSheet.id);
  };

  return (
    <div className="sheet-tabs scrollbar-thin">
      {sheets.map((sheet) => (
        <button
          key={sheet.id}
          className={`sheet-tab ${sheet.id === activeSheetId ? 'active' : ''}`}
          onClick={() => setActiveSheet(sheet.id)}
        >
          {sheet.name}
        </button>
      ))}
      <button className="sheet-tab-add" onClick={handleAddSheet} title="新建工作表">
        +
      </button>
    </div>
  );
};
