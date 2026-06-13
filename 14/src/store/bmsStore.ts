import { create } from 'zustand';
import type {
  CellData,
  PackData,
  SOHResult,
  BalanceCommand,
  AlertRecord,
  SOHHistoryPoint,
  BalanceLogPoint,
  HistoryDataPoint,
  ConfidenceInterval,
  ReportConfig
} from '../types';
import { BmsSimulator } from '../utils/bmsSimulator';
import { SOHEngine } from '../utils/sohEngine';
import { BalanceEngine } from '../utils/balanceEngine';
import { calculateConfidenceInterval } from '../utils/statistics';
import ExcelJS from 'exceljs';

type CurrentPage = 'monitor' | 'soh' | 'balance' | 'history' | 'report';

interface BmsStore {
  simulator: BmsSimulator;
  sohEngine: SOHEngine;
  balanceEngine: BalanceEngine;
  cells: CellData[];
  pack: PackData;
  sohResults: SOHResult[];
  balanceCommands: BalanceCommand[];
  alerts: AlertRecord[];
  sohHistory: SOHHistoryPoint[][];
  balanceLogs: BalanceLogPoint[][];
  capacityHistory: HistoryDataPoint[][];
  convergenceSeries: {
    timestamps: number[];
    deltas: number[];
    converged: boolean;
    convergeTime: number;
  };
  isCharging: boolean;
  isBalancing: boolean;
  isSimulationRunning: boolean;
  simulationSpeed: number;
  currentPage: CurrentPage;
  selectedCellId: number | null;
  icaVoltageBuffer: number[][];
  _timer: ReturnType<typeof setInterval> | null;
  _alertTimer: number;

  init: () => void;
  startSimulation: () => void;
  stopSimulation: () => void;
  setSimulationSpeed: (speed: number) => void;
  setCharging: (charging: boolean) => void;
  setBalancing: (balancing: boolean) => void;
  toggleSimulation: () => void;
  setCurrentPage: (page: CurrentPage) => void;
  selectCell: (id: number | null) => void;
  loadHistoryData: (days?: number) => void;
  loadSOHHistory: (cycles?: number) => void;
  loadBalanceLogs: (minutes?: number) => void;
  runConvergenceSimulation: () => void;
  acknowledgeAlert: (idx: number) => void;
  generateReport: (config: ReportConfig) => Promise<Blob>;
}

export const useBmsStore = create<BmsStore>((set, get) => ({
  simulator: new BmsSimulator(),
  sohEngine: new SOHEngine(),
  balanceEngine: new BalanceEngine(),
  cells: [],
  pack: {
    packId: 'PACK-001',
    totalVoltage: 0,
    totalCurrent: 0,
    power: 0,
    avgTemperature: 25,
    cycleCount: 0,
    timestamp: Date.now()
  },
  sohResults: [],
  balanceCommands: [],
  alerts: [],
  sohHistory: [],
  balanceLogs: [],
  capacityHistory: [],
  convergenceSeries: {
    timestamps: [],
    deltas: [],
    converged: false,
    convergeTime: 0
  },
  isCharging: false,
  isBalancing: false,
  isSimulationRunning: false,
  simulationSpeed: 1,
  currentPage: 'monitor',
  selectedCellId: null,
  icaVoltageBuffer: [],
  _timer: null,
  _alertTimer: 0,

  init: () => {
    const simulator = new BmsSimulator();
    const sohEngine = new SOHEngine();
    const balanceEngine = new BalanceEngine();

    const cells = simulator.getCells();
    const pack = simulator.getPack();
    const sohResults = sohEngine.estimateAllCells(cells);
    const balanceCommands = balanceEngine.generateCommands(cells);

    set({
      simulator,
      sohEngine,
      balanceEngine,
      cells,
      pack,
      sohResults,
      balanceCommands,
      alerts: [],
      sohHistory: [],
      balanceLogs: [],
      capacityHistory: [],
      icaVoltageBuffer: cells.map(() => []),
      isCharging: false,
      isBalancing: false,
      isSimulationRunning: false,
      simulationSpeed: 1,
      convergenceSeries: {
        timestamps: [],
        deltas: [],
        converged: false,
        convergeTime: 0
      }
    });
  },

  startSimulation: () => {
    const state = get();
    if (state._timer) {
      clearInterval(state._timer);
    }

    state._alertTimer = 0;
    const baseInterval = 100;
    const interval = baseInterval / state.simulationSpeed;

    const timer = setInterval(() => {
      const s = get();

      const commands: BalanceCommand[] = s.isBalancing ? s.balanceCommands : [];
      const dtMs = 100 * state.simulationSpeed;
      for (let i = 0; i < state.simulationSpeed; i++) {
        s.simulator.tick(dtMs / state.simulationSpeed, commands);
      }

      const newCells = s.simulator.getCells();
      const newPack = s.simulator.getPack();
      const newSohResults = s.sohEngine.estimateAllCells(newCells, s.isCharging);
      const newBalanceCommands = s.balanceEngine.generateCommands(newCells);

      const newIcaBuffer = newCells.map((cell, idx) => {
        const prev = s.icaVoltageBuffer[idx] || [];
        return [...prev, cell.voltage].slice(-200);
      });

      s._alertTimer++;
      let newAlerts = s.alerts;
      let newConvergence = s.convergenceSeries;
      if (s._alertTimer >= 50) {
        s._alertTimer = 0;
        const freshAlerts = s.simulator.generateAlerts();
        const existingMap = new Map(s.alerts.map(a => [`${a.type}-${a.cellId}`, a]));
        freshAlerts.forEach(a => {
          const key = `${a.type}-${a.cellId}`;
          if (!existingMap.has(key)) {
            existingMap.set(key, a);
          }
        });
        newAlerts = Array.from(existingMap.values()).sort((a, b) => b.timestamp - a.timestamp);
        newConvergence = s.balanceEngine.evaluateConvergence(newCells);
      }

      set({
        cells: newCells,
        pack: newPack,
        sohResults: newSohResults,
        balanceCommands: newBalanceCommands,
        icaVoltageBuffer: newIcaBuffer,
        alerts: newAlerts,
        convergenceSeries: newConvergence
      });
    }, interval);

    set({
      _timer: timer,
      isSimulationRunning: true
    });
  },

  stopSimulation: () => {
    const state = get();
    if (state._timer) {
      clearInterval(state._timer);
    }
    set({
      _timer: null,
      isSimulationRunning: false
    });
  },

  setSimulationSpeed: (speed: number) => {
    const validSpeed = [1, 2, 5, 10].includes(speed) ? speed : 1;
    const wasRunning = get().isSimulationRunning;
    if (wasRunning) {
      get().stopSimulation();
    }
    set({ simulationSpeed: validSpeed });
    if (wasRunning) {
      setTimeout(() => get().startSimulation(), 0);
    }
  },

  setCharging: (charging: boolean) => {
    get().simulator.setCharging(charging);
    set({ isCharging: charging });
  },

  setBalancing: (balancing: boolean) => {
    get().simulator.setBalancing(balancing);
    set({ isBalancing: balancing });
  },

  toggleSimulation: () => {
    const state = get();
    if (state.isSimulationRunning) {
      state.stopSimulation();
    } else {
      state.startSimulation();
    }
  },

  setCurrentPage: (page: CurrentPage) => {
    set({ currentPage: page });
  },

  selectCell: (id: number | null) => {
    set({ selectedCellId: id });
  },

  loadHistoryData: (days: number = 30) => {
    const data = get().simulator.generateInitialHistory(days);
    set({ capacityHistory: data });
  },

  loadSOHHistory: (cycles: number = 500) => {
    const data = get().simulator.generateSOHHistory(cycles);
    set({ sohHistory: data });
  },

  loadBalanceLogs: (minutes: number = 60) => {
    const data = get().simulator.generateBalanceLogs(minutes);
    set({ balanceLogs: data });
  },

  runConvergenceSimulation: () => {
    const state = get();
    const result = state.balanceEngine.evaluateConvergence(state.cells);
    set({ convergenceSeries: result });
  },

  acknowledgeAlert: (idx: number) => {
    set(state => {
      const newAlerts = [...state.alerts];
      if (newAlerts[idx]) {
        newAlerts[idx] = { ...newAlerts[idx], acknowledged: true };
      }
      return { alerts: newAlerts };
    });
  },

  generateReport: async (config: ReportConfig): Promise<Blob> => {
    const state = get();
    const workbook = new ExcelJS.Workbook();
    const HEADER_FILL = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E3A5F' }
    } as const;
    const HEADER_FONT = { bold: true, color: { argb: 'FFE0F7FF' }, size: 11 } as const;

    const autoSizeColumns = (ws: ExcelJS.Worksheet) => {
      ws.columns.forEach(col => {
        let maxLen = 12;
        col.eachCell({ includeEmpty: true }, (cell) => {
          const v = cell.value;
          const len = v === null || v === undefined ? 4 :
            typeof v === 'number' ? Math.max(8, String(v.toFixed(2)).length) :
            String(v).length;
          if (len > maxLen) maxLen = len;
        });
        col.width = Math.min(40, maxLen + 4);
      });
    };

    const applyHeaderStyle = (ws: ExcelJS.Worksheet, headerRow: number, colCount: number) => {
      const row = ws.getRow(headerRow);
      row.font = HEADER_FONT;
      row.fill = HEADER_FILL;
      row.alignment = { horizontal: 'center', vertical: 'middle' };
      row.height = 24;
      for (let c = 1; c <= colCount; c++) {
        ws.getCell(headerRow, c).border = {
          top: { style: 'thin', color: { argb: 'FF4A6A9A' } },
          left: { style: 'thin', color: { argb: 'FF4A6A9A' } },
          bottom: { style: 'thin', color: { argb: 'FF4A6A9A' } },
          right: { style: 'thin', color: { argb: 'FF4A6A9A' } }
        };
      }
      ws.views = [{ state: 'frozen', ySplit: headerRow }];
    };

    const addTitleRow = (ws: ExcelJS.Worksheet, title: string, colCount: number) => {
      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = title;
      titleCell.font = { bold: true, size: 14, color: { argb: 'FF00F0FF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2035' } };
      ws.getRow(1).height = 30;
      const info = `生成时间: ${new Date().toLocaleString()} | 电池包: ${state.pack.packId}`;
      ws.mergeCells(2, 1, 2, colCount);
      const infoCell = ws.getCell(2, 1);
      infoCell.value = info;
      infoCell.font = { size: 9, color: { argb: 'FF8BA3C7' }, italic: true };
      infoCell.alignment = { horizontal: 'right' };
      ws.getRow(2).height = 18;
    };

    const statusFromError = (err: number): string => {
      const abs = Math.abs(err);
      if (abs < 1) return '优';
      if (abs <= 2) return '良';
      return '超标';
    };

    const toCSV = (rows: (string | number)[][]): string => {
      const BOM = '\uFEFF';
      return BOM + rows.map(r =>
        r.map(v => {
          const s = String(v ?? '');
          if (s.includes(',') || s.includes('"') || s.includes('\n')) {
            return '"' + s.replace(/"/g, '""') + '"';
          }
          return s;
        }).join(',')
      ).join('\r\n');
    };

    if (config.type === 'SOH') {
      const ws = workbook.addWorksheet('SOH估算报表', { views: [{ showGridLines: true }] });
      const colCount = config.includeConfidence ? 7 : 5;
      addTitleRow(ws, `SOH 健康状态估算报表 (共 ${state.sohResults.length} 串电芯)`, colCount);
      const header = ['cellId', 'SOH估计(%)', 'SOH实际(%)', '误差(%)', '状态'];
      if (config.includeConfidence) header.splice(3, 0, '95%置信下界(%)', '95%置信上界(%)');
      ws.addRow(header);
      applyHeaderStyle(ws, 3, colCount);
      state.sohResults.forEach(r => {
        const cell = state.cells.find(c => c.cellId === r.cellId);
        const row = [
          r.cellId,
          Number(r.soh.toFixed(3)),
          cell ? Number(cell.soh.toFixed(3)) : 0,
          Number(r.error.toFixed(3)),
          statusFromError(r.error)
        ];
        if (config.includeConfidence) {
          row.splice(3, 0,
            Number(r.confidence[0].toFixed(3)),
            Number(r.confidence[1].toFixed(3))
          );
        }
        const excelRow = ws.addRow(row);
        const statusCell = excelRow.getCell(colCount);
        const statusVal = statusFromError(r.error);
        if (statusVal === '优') statusCell.font = { color: { argb: 'FF00E676' }, bold: true };
        else if (statusVal === '良') statusCell.font = { color: { argb: 'FFFF8C00' }, bold: true };
        else statusCell.font = { color: { argb: 'FFFF1744' }, bold: true };
      });
      autoSizeColumns(ws);

      if (config.format === 'csv') {
        const rows: (string | number)[][] = [header];
        state.sohResults.forEach(r => {
          const cell = state.cells.find(c => c.cellId === r.cellId);
          const row = [
            r.cellId,
            r.soh.toFixed(3),
            cell ? cell.soh.toFixed(3) : '0',
            r.error.toFixed(3),
            statusFromError(r.error)
          ];
          if (config.includeConfidence) {
            row.splice(3, 0, r.confidence[0].toFixed(3), r.confidence[1].toFixed(3));
          }
          rows.push(row);
        });
        return new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' });
      }
    }

    if (config.type === 'BALANCE') {
      const ws = workbook.addWorksheet('均衡效果报表', { views: [{ showGridLines: true }] });
      const colCount = state.cells.length > 0 ? Math.min(12, state.cells.length * 2 + 3) : 6;
      const balanceLogs = state.balanceLogs.length > 0
        ? state.balanceLogs[0].slice(-200)
        : [];
      addTitleRow(ws, `主动均衡效果报表 (${balanceLogs.length} 条日志)`, colCount);

      const displayCount = Math.min(10, state.cells.length);
      const header: string[] = ['时间戳', '总压差(mV)'];
      for (let i = 0; i < displayCount; i++) {
        const id = state.cells[i]?.cellId ?? `C${i + 1}`;
        header.push(`${id}电流(A)`);
        header.push(`${id}PWM(%)`);
      }
      ws.addRow(header);
      applyHeaderStyle(ws, 3, header.length);

      const voltages = state.cells.map(c => c.voltage);
      const initialDelta = voltages.length > 0 ? (Math.max(...voltages) - Math.min(...voltages)) * 1000 : 0;
      const convDelta = state.convergenceSeries.deltas.length > 0
        ? state.convergenceSeries.deltas[state.convergenceSeries.deltas.length - 1] * 1000
        : initialDelta;

      const sampleRows = Math.min(50, state.convergenceSeries.deltas.length);
      for (let i = 0; i < sampleRows; i++) {
        const ts = state.convergenceSeries.timestamps[i];
        const tsStr = new Date(ts).toLocaleTimeString();
        const d = state.convergenceSeries.deltas[i] * 1000;
        const row: (string | number)[] = [tsStr, Number(d.toFixed(2))];
        for (let j = 0; j < displayCount; j++) {
          const cmd = state.balanceCommands[j];
          const c = i === sampleRows - 1 && cmd ? cmd.current : 0;
          const pwm = i === sampleRows - 1 && cmd ? cmd.pwmDuty : 0;
          row.push(Number(c.toFixed(3)), Number(pwm.toFixed(1)));
        }
        ws.addRow(row);
      }

      ws.addRow([]);
      const summaryHeader = ['指标', '数值', '单位'];
      ws.addRow(summaryHeader);
      applyHeaderStyle(ws, ws.rowCount, 3);
      const summaries: (string | number)[][] = [
        ['初始压差', Number(initialDelta.toFixed(2)), 'mV'],
        ['最终压差', Number(convDelta.toFixed(2)), 'mV'],
        ['收敛时间', state.convergenceSeries.convergeTime, 'min'],
        ['收敛状态', state.convergenceSeries.converged ? '已收敛' : '未收敛', '-'],
        ['执行指令数', state.balanceCommands.filter(c => c.current > 0.001).length, '串']
      ];
      summaries.forEach(s => ws.addRow(s));
      autoSizeColumns(ws);

      if (config.format === 'csv') {
        const rows: (string | number)[][] = [header];
        const sampleRows = Math.min(50, state.convergenceSeries.deltas.length);
        for (let i = 0; i < sampleRows; i++) {
          const ts = state.convergenceSeries.timestamps[i];
          const tsStr = new Date(ts).toLocaleTimeString();
          const d = state.convergenceSeries.deltas[i] * 1000;
          const row: (string | number)[] = [tsStr, d.toFixed(2)];
          for (let j = 0; j < displayCount; j++) {
            const cmd = state.balanceCommands[j];
            const c = i === sampleRows - 1 && cmd ? cmd.current : 0;
            const pwm = i === sampleRows - 1 && cmd ? cmd.pwmDuty : 0;
            row.push(c.toFixed(3), pwm.toFixed(1));
          }
          rows.push(row);
        }
        rows.push([]);
        rows.push(summaryHeader);
        summaries.forEach(s => rows.push(s));
        return new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' });
      }
    }

    if (config.type === 'DECAY') {
      const ws = workbook.addWorksheet('容量衰减报表', { views: [{ showGridLines: true }] });
      const colCount = config.includeConfidence ? 5 : 3;
      const history = state.capacityHistory.length > 0 ? state.capacityHistory[0] : [];
      addTitleRow(ws, `电池容量衰减趋势报表 (${history.length} 条数据)`, colCount);

      const header = ['时间', '平均容量(Ah)', '平均SOH(%)'];
      if (config.includeConfidence) header.splice(2, 0, '95%容量下界(Ah)', '95%容量上界(Ah)');
      ws.addRow(header);
      applyHeaderStyle(ws, 3, colCount);

      const groupByDay = new Map<number, { caps: number[]; sohs: number[] }>();
      history.forEach(pt => {
        const day = Math.floor(pt.timestamp / 86400000) * 86400000;
        if (!groupByDay.has(day)) groupByDay.set(day, { caps: [], sohs: [] });
        groupByDay.get(day)!.caps.push(pt.capacity);
        groupByDay.get(day)!.sohs.push(pt.soh);
      });
      const sortedDays = Array.from(groupByDay.keys()).sort((a, b) => a - b);

      sortedDays.forEach(day => {
        const { caps, sohs } = groupByDay.get(day)!;
        const avgCap = caps.reduce((a, b) => a + b, 0) / caps.length;
        const avgSoh = sohs.reduce((a, b) => a + b, 0) / sohs.length;
        const ci = calculateConfidenceInterval(caps, 0.95);

        const row: (string | number)[] = [
          new Date(day).toLocaleDateString(),
          Number(avgCap.toFixed(2)),
          Number(avgSoh.toFixed(2))
        ];
        if (config.includeConfidence) {
          row.splice(2, 0,
            Number(ci.lower95.toFixed(2)),
            Number(ci.upper95.toFixed(2))
          );
        }
        ws.addRow(row);
      });
      autoSizeColumns(ws);

      if (config.format === 'csv') {
        const rows: (string | number)[][] = [header];
        sortedDays.forEach(day => {
          const { caps, sohs } = groupByDay.get(day)!;
          const avgCap = caps.reduce((a, b) => a + b, 0) / caps.length;
          const avgSoh = sohs.reduce((a, b) => a + b, 0) / sohs.length;
          const ci = calculateConfidenceInterval(caps, 0.95);
          const row: (string | number)[] = [
            new Date(day).toLocaleDateString(),
            avgCap.toFixed(2),
            avgSoh.toFixed(2)
          ];
          if (config.includeConfidence) {
            row.splice(2, 0, ci.lower95.toFixed(2), ci.upper95.toFixed(2));
          }
          rows.push(row);
        });
        return new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' });
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
}));
