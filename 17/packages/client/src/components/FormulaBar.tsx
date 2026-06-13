import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';

const getColumnLetter = (col: number): string => {
  let result = '';
  let n = col;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
};

const getCellRef = (row: number, col: number): string => {
  return `${getColumnLetter(col)}${row + 1}`;
};

const FORMULA_SUGGESTIONS = [
  { name: 'SUM', desc: '求和：返回一组数字的总和' },
  { name: 'AVERAGE', desc: '平均值：返回一组数字的平均值' },
  { name: 'MAX', desc: '最大值：返回一组数字中的最大值' },
  { name: 'MIN', desc: '最小值：返回一组数字中的最小值' },
  { name: 'COUNT', desc: '计数：统计包含数字的单元格数量' },
  { name: 'IF', desc: '条件判断：根据条件返回不同值' },
  { name: 'VLOOKUP', desc: '纵向查找：在首列查找并返回指定列的值' },
  { name: 'CONCAT', desc: '连接：将多个文本字符串合并为一个' },
];

export const FormulaBar: React.FC = () => {
  const {
    selectedCell,
    editingCell,
    editValue,
    cells,
    startEditing,
    setEditValue,
    finishEditing,
    cancelEditing,
    selectCell,
  } = useAppStore();

  const inputRef = useRef<HTMLInputElement>(null);
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [suggestionFilter, setSuggestionFilter] = React.useState('');
  const [activeSuggestionIdx, setActiveSuggestionIdx] = React.useState(0);

  const cellRef = selectedCell ? getCellRef(selectedCell.row, selectedCell.col) : '';

  const currentCell =
    selectedCell && cells[`${selectedCell.sheetId}:${selectedCell.row}:${selectedCell.col}`];
  const displayValue = currentCell?.formula ?? currentCell?.value ?? '';

  const isFormulaMode = editingCell && editValue.startsWith('=');

  const filteredSuggestions = FORMULA_SUGGESTIONS.filter((s) =>
    s.name.toLowerCase().includes(suggestionFilter.toLowerCase())
  );

  useEffect(() => {
    if (isFormulaMode) {
      const match = editValue.match(/=([A-Za-z]*)$/);
      if (match) {
        setSuggestionFilter(match[1]);
        setShowSuggestions(match[1].length > 0 || editValue === '=');
        setActiveSuggestionIdx(0);
      } else {
        setShowSuggestions(false);
      }
    } else {
      setShowSuggestions(false);
    }
  }, [editValue, isFormulaMode]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (!editingCell && selectedCell) {
      startEditing(selectedCell, value);
    } else {
      setEditValue(value);
    }
  };

  const handleInputFocus = () => {
    if (selectedCell && !editingCell) {
      startEditing(selectedCell);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSuggestions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestionIdx((prev) =>
          prev < filteredSuggestions.length - 1 ? prev + 1 : prev
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestionIdx((prev) => (prev > 0 ? prev - 1 : prev));
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        if (filteredSuggestions.length > 0) {
          e.preventDefault();
          const selected = filteredSuggestions[activeSuggestionIdx];
          const newValue = editValue.replace(/=[A-Za-z]*$/, `=${selected.name}(`);
          setEditValue(newValue);
          setShowSuggestions(false);
        }
      } else if (e.key === 'Escape') {
        setShowSuggestions(false);
      }
    }

    if (e.key === 'Enter' && !showSuggestions) {
      e.preventDefault();
      finishEditing();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditing();
      if (selectedCell) {
        selectCell(selectedCell);
      }
    }
  };

  const handleSuggestionClick = (name: string) => {
    const newValue = editValue.replace(/=[A-Za-z]*$/, `=${name}(`);
    setEditValue(newValue);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  return (
    <div className="formula-bar">
      <div className="formula-bar-cell-ref">{cellRef}</div>
      <div
        className={`formula-bar-fx ${isFormulaMode ? 'active' : ''}`}
        onClick={() => {
          if (selectedCell && !editingCell) {
            startEditing(selectedCell, '=');
          } else if (editingCell) {
            setEditValue(editValue.startsWith('=') ? editValue : `=${editValue}`);
          }
          inputRef.current?.focus();
        }}
        title="插入函数"
      >
        fx
      </div>
      <div style={{ position: 'relative', flex: 1 }}>
        <input
          ref={inputRef}
          className="formula-bar-input"
          type="text"
          value={editingCell ? editValue : String(displayValue ?? '')}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleInputKeyDown}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder="输入值或公式（以 = 开头）"
        />
        {showSuggestions && filteredSuggestions.length > 0 && (
          <div className="formula-suggestion" style={{ top: '100%', left: 0, marginTop: 2 }}>
            {filteredSuggestions.map((s, idx) => (
              <div
                key={s.name}
                className={`formula-suggestion-item ${idx === activeSuggestionIdx ? 'active' : ''}`}
                onClick={() => handleSuggestionClick(s.name)}
              >
                <span className="formula-suggestion-name">{s.name}</span>
                <span className="formula-suggestion-desc">{s.desc}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
