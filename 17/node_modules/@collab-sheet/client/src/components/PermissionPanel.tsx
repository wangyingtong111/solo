import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { usePermissionStore } from '../store/usePermissionStore';
import type { CellRange } from '../types';

const getColumnLetter = (col: number): string => {
  let result = '';
  let n = col;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
};

const formatRange = (range: CellRange, sheetName?: string): string => {
  const start = `${getColumnLetter(range.startCol)}${range.startRow + 1}`;
  const end = `${getColumnLetter(range.endCol)}${range.endRow + 1}`;
  const prefix = sheetName ? `${sheetName}!` : '';
  return range.startRow === range.endRow && range.startCol === range.endCol
    ? `${prefix}${start}`
    : `${prefix}${start}:${end}`;
};

const roleLabel: Record<string, string> = {
  owner: '所有者',
  editor: '编辑者',
  viewer: '查看者',
};

export const PermissionPanel: React.FC = () => {
  const { currentUser, rules, editableRanges } = usePermissionStore();
  const { closePermissionPanel } = useAppStore();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRangeStart, setNewRangeStart] = useState('A1');
  const [newRangeEnd, setNewRangeEnd] = useState('A1');

  const editableColors = ['#1a73e8', '#34a853', '#fbbc04', '#ea4335', '#a142f4'];

  return (
    <div className="panel-overlay" onClick={closePermissionPanel}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">权限管理</div>
          <button className="panel-close" onClick={closePermissionPanel}>
            ×
          </button>
        </div>
        <div className="panel-body">
          {currentUser && (
            <div className="permission-section">
              <div className="permission-section-title">我的角色</div>
              <div className="current-user-card">
                <div
                  className="user-avatar-large"
                  style={{ backgroundColor: currentUser.color }}
                >
                  {currentUser.name.charAt(0).toUpperCase()}
                </div>
                <div className="user-info">
                  <div className="user-name">
                    {currentUser.name} <span style={{ color: '#5f6368', fontSize: 12 }}>(我)</span>
                  </div>
                  <div className="user-role">{roleLabel[currentUser.role] || currentUser.role}</div>
                </div>
              </div>
            </div>
          )}

          <div className="permission-section">
            <div className="permission-section-title">
              我的可编辑范围
              <span style={{ color: '#5f6368', fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
                ({editableRanges.length} 个)
              </span>
            </div>
            {editableRanges.length === 0 ? (
              <div style={{ color: '#5f6368', fontSize: 13, padding: '8px 0' }}>
                暂无分配的可编辑范围
              </div>
            ) : (
              <div className="range-list">
                {editableRanges.map((range, idx) => (
                  <div key={idx} className="range-item">
                    <div
                      className="range-color"
                      style={{ backgroundColor: editableColors[idx % editableColors.length] }}
                    />
                    <span className="range-text">{formatRange(range)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="permission-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div className="permission-section-title" style={{ marginBottom: 0 }}>
                所有权限规则
              </div>
              <button
                style={{
                  fontSize: 12,
                  color: '#1a73e8',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 500,
                  padding: 0,
                }}
                onClick={() => setShowAddForm(!showAddForm)}
              >
                {showAddForm ? '取消' : '+ 添加规则'}
              </button>
            </div>
            {showAddForm && (
              <div className="add-permission-form">
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>添加权限范围</div>
                <div className="form-row">
                  <input
                    className="form-input"
                    placeholder="起始单元格 (如 A1)"
                    value={newRangeStart}
                    onChange={(e) => setNewRangeStart(e.target.value)}
                  />
                  <input
                    className="form-input"
                    placeholder="结束单元格 (如 C10)"
                    value={newRangeEnd}
                    onChange={(e) => setNewRangeEnd(e.target.value)}
                  />
                </div>
                <div className="form-row">
                  <select className="form-select" defaultValue="editor">
                    <option value="editor">可编辑</option>
                    <option value="viewer">仅查看</option>
                  </select>
                  <button
                    className="version-button primary"
                    style={{ flex: 1 }}
                    onClick={() => setShowAddForm(false)}
                  >
                    确认添加
                  </button>
                </div>
              </div>
            )}
            {rules.length === 0 ? (
              <div style={{ color: '#5f6368', fontSize: 13, padding: '8px 0' }}>
                暂无权限规则
              </div>
            ) : (
              <div className="range-list">
                {rules.map((rule) => (
                  <div key={rule.id} className="range-item">
                    <div
                      className="range-color"
                      style={{ backgroundColor: rule.canEdit ? '#34a853' : '#fbbc04' }}
                    />
                    <span className="range-text">{formatRange(rule.cellRange)}</span>
                    <span className="range-owner">{rule.canEdit ? '可编辑' : '仅查看'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="panel-footer">
          <button className="version-button" onClick={closePermissionPanel}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
