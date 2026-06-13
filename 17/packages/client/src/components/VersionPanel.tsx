import React, { useState, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { VersionSnapshot, VersionDiff } from '../types';

const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const VersionPanel: React.FC = () => {
  const { versionHistory, closeVersionPanel } = useAppStore();
  const [selectedVersion, setSelectedVersion] = useState<VersionSnapshot | null>(null);
  const [compareVersion, setCompareVersion] = useState<string | null>(null);
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [isComparing, setIsComparing] = useState(false);

  const sortedHistory = useMemo(
    () => [...versionHistory].sort((a, b) => b.createdAt - a.createdAt),
    [versionHistory]
  );

  const handleCompare = () => {
    if (!selectedVersion || !compareVersion || selectedVersion.id === compareVersion) return;
    const verA = versionHistory.find((v) => v.id === compareVersion);
    const verB = selectedVersion;
    if (!verA) return;

    const addedCells: any[] = [];
    const modifiedCells: any[] = [];
    const deletedCells: string[] = [];
    const addedSheets: any[] = [];
    const modifiedSheets: any[] = [];
    const deletedSheets: string[] = [];

    const allCellIds = new Set([...Object.keys(verA.cells), ...Object.keys(verB.cells)]);
    for (const cellId of allCellIds) {
      const cellA = verA.cells[cellId];
      const cellB = verB.cells[cellId];
      if (!cellA && cellB) {
        addedCells.push(cellB);
      } else if (cellA && !cellB) {
        deletedCells.push(cellId);
      } else if (cellA && cellB && (cellA.value !== cellB.value || cellA.formula !== cellB.formula)) {
        modifiedCells.push({ cellId, oldValue: cellA, newValue: cellB });
      }
    }

    const allSheetIds = new Set([...verA.sheets.map((s) => s.id), ...verB.sheets.map((s) => s.id)]);
    for (const sheetId of allSheetIds) {
      const sheetA = verA.sheets.find((s) => s.id === sheetId);
      const sheetB = verB.sheets.find((s) => s.id === sheetId);
      if (!sheetA && sheetB) {
        addedSheets.push(sheetB);
      } else if (sheetA && !sheetB) {
        deletedSheets.push(sheetId);
      } else if (sheetA && sheetB && sheetA.name !== sheetB.name) {
        modifiedSheets.push({ sheetId, oldSheet: sheetA, newSheet: sheetB });
      }
    }

    setDiff({
      addedCells,
      modifiedCells,
      deletedCells,
      addedSheets,
      modifiedSheets,
      deletedSheets,
    });
    setIsComparing(true);
  };

  const handleRollback = (version: VersionSnapshot) => {
    if (confirm(`确定要回退到版本「${version.name}」吗？`)) {
      // TODO: 调用 API 执行回退
      console.log('Rollback to:', version.id);
    }
  };

  return (
    <div className="panel-overlay" onClick={closeVersionPanel}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">版本历史</div>
          <button className="panel-close" onClick={closeVersionPanel}>
            ×
          </button>
        </div>
        <div className="panel-body">
          {sortedHistory.length === 0 ? (
            <div style={{ color: '#5f6368', textAlign: 'center', padding: '40px 0' }}>
              暂无版本快照
            </div>
          ) : isComparing && diff ? (
            <div>
              <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 500 }}>
                  对比：{compareVersion} → {selectedVersion?.id}
                </span>
                <button className="version-button" onClick={() => { setIsComparing(false); setDiff(null); }}>
                  返回列表
                </button>
              </div>
              <div className="diff-view">
                {diff.addedCells.map((cell: any) => (
                  <div key={`add-${cell.id}`} className="diff-row added">
                    <span className="diff-type added">+</span>
                    <span className="diff-content">{cell.id}: {cell.value ?? cell.formula ?? '(空)'}</span>
                  </div>
                ))}
                {diff.deletedCells.map((cellId) => (
                  <div key={`del-${cellId}`} className="diff-row deleted">
                    <span className="diff-type deleted">−</span>
                    <span className="diff-content">{cellId}: (已删除)</span>
                  </div>
                ))}
                {diff.modifiedCells.map((m: any) => (
                  <div key={`mod-${m.cellId}`} className="diff-row modified">
                    <span className="diff-type modified">~</span>
                    <span className="diff-content">
                      {m.cellId}: {m.oldValue.value ?? '(空)'} → {m.newValue.value ?? '(空)'}
                    </span>
                  </div>
                ))}
                {diff.addedSheets.map((sheet: any) => (
                  <div key={`add-sheet-${sheet.id}`} className="diff-row added">
                    <span className="diff-type added">+</span>
                    <span className="diff-content">工作表: {sheet.name}</span>
                  </div>
                ))}
                {diff.deletedSheets.length === 0 && diff.addedCells.length === 0 && diff.deletedCells.length === 0 && diff.modifiedCells.length === 0 && diff.addedSheets.length === 0 && (
                  <div className="diff-row">
                    <span className="diff-type"> </span>
                    <span className="diff-content" style={{ color: '#5f6368' }}>两个版本无差异</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="version-list">
                {sortedHistory.map((version) => (
                  <div
                    key={version.id}
                    className={`version-item ${selectedVersion?.id === version.id ? 'selected' : ''}`}
                    onClick={() => setSelectedVersion(version)}
                  >
                    <div className="version-info">
                      <div className="version-name">{version.name}</div>
                      <div className="version-meta">
                        {formatDate(version.createdAt)} · 由 {version.createdBy} 创建
                      </div>
                    </div>
                    <div className="version-actions">
                      <button
                        className="version-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCompareVersion(version.id);
                          setSelectedVersion(sortedHistory[0]);
                          handleCompare();
                        }}
                      >
                        对比
                      </button>
                      <button
                        className="version-button primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRollback(version);
                        }}
                      >
                        回退
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="panel-footer">
          <button className="version-button" onClick={closeVersionPanel}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
