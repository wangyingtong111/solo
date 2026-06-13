import { create } from 'zustand';
import type { Cell } from '../types';

type FormulaValue = string | number | boolean | null;

interface FormulaCacheEntry {
  value: FormulaValue;
  error?: string;
  timestamp: number;
}

interface DependencyGraph {
  dependents: Map<string, Set<string>>;
  dependencies: Map<string, Set<string>>;
}

export interface FormulaStoreState {
  cache: Record<string, FormulaCacheEntry>;
  dependencyGraph: DependencyGraph;
}

export interface FormulaStoreActions {
  getCachedResult: (cellId: string) => FormulaCacheEntry | null;
  setCachedResult: (cellId: string, value: FormulaValue, error?: string) => void;
  invalidateCache: (cellId: string) => void;
  invalidateAll: () => void;
  addDependency: (cellId: string, dependencyId: string) => void;
  removeDependencies: (cellId: string) => void;
  getDependents: (cellId: string) => string[];
  getDependencies: (cellId: string) => string[];
  getAllDependentsRecursive: (cellId: string) => string[];
  getCalculationOrder: (changedCellId: string) => string[];
  onCellChange: (cellId: string, cell: Cell) => string[];
  hasCell: (cellId: string) => boolean;
  clearGraph: () => void;
}

export type FormulaStore = FormulaStoreState & FormulaStoreActions;

const wouldCreateCycle = (
  graph: DependencyGraph,
  cellId: string,
  dependencyId: string
): boolean => {
  const visited = new Set<string>();
  const stack: string[] = [dependencyId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === cellId) {
      return true;
    }
    if (!visited.has(current)) {
      visited.add(current);
      const deps = graph.dependencies.get(current);
      if (deps) {
        for (const dep of deps) {
          stack.push(dep);
        }
      }
    }
  }

  return false;
};

const getOrCreateSet = (map: Map<string, Set<string>>, key: string): Set<string> => {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  return set;
};

const hasDependencyInSet = (
  graph: DependencyGraph,
  cellId: string,
  set: string[]
): boolean => {
  const deps = graph.dependencies.get(cellId);
  if (!deps) return false;
  for (const dep of deps) {
    if (set.includes(dep)) {
      return true;
    }
    if (hasDependencyInSet(graph, dep, set)) {
      return true;
    }
  }
  return false;
};

const topologicalSort = (graph: DependencyGraph, startCells: string[]): string[] => {
  const inDegree = new Map<string, number>();
  const queue: string[] = [];
  const result: string[] = [];
  const visited = new Set<string>();

  const allCells = new Set<string>();
  for (const cell of startCells) {
    allCells.add(cell);
    const visitedRecursive = new Set<string>();
    const queueRecursive: string[] = [cell];

    while (queueRecursive.length > 0) {
      const current = queueRecursive.shift()!;
      const dependents = graph.dependents.get(current);
      if (dependents) {
        for (const dep of dependents) {
          if (!visitedRecursive.has(dep)) {
            visitedRecursive.add(dep);
            allCells.add(dep);
            queueRecursive.push(dep);
          }
        }
      }
    }
  }

  for (const cell of allCells) {
    const deps = graph.dependencies.get(cell);
    const depsArray = deps ? Array.from(deps) : [];
    const relevantDeps = depsArray.filter((d) => allCells.has(d));
    inDegree.set(cell, relevantDeps.length);
    if (relevantDeps.length === 0) {
      queue.push(cell);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (!visited.has(current)) {
      visited.add(current);
      if (startCells.includes(current) || hasDependencyInSet(graph, current, startCells)) {
        result.push(current);
      }

      const dependents = graph.dependents.get(current);
      if (dependents) {
        for (const dep of dependents) {
          if (allCells.has(dep)) {
            const degree = inDegree.get(dep)!;
            inDegree.set(dep, degree - 1);
            if (degree - 1 === 0) {
              queue.push(dep);
            }
          }
        }
      }
    }
  }

  if (result.length !== allCells.size) {
    throw new Error('Circular reference detected in dependency graph');
  }

  return result;
};

const getAllDependentsRecursive = (graph: DependencyGraph, cellId: string): string[] => {
  const visited = new Set<string>();
  const result: string[] = [];
  const queue: string[] = [cellId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents = graph.dependents.get(current);
    if (dependents) {
      for (const dep of dependents) {
        if (!visited.has(dep)) {
          visited.add(dep);
          result.push(dep);
          queue.push(dep);
        }
      }
    }
  }

  return result;
};

export const useFormulaStore = create<FormulaStore>((set, get) => ({
  cache: {},
  dependencyGraph: {
    dependents: new Map(),
    dependencies: new Map(),
  },

  getCachedResult: (cellId) => {
    return get().cache[cellId] ?? null;
  },

  setCachedResult: (cellId, value, error) => {
    set({
      cache: {
        ...get().cache,
        [cellId]: {
          value,
          error,
          timestamp: Date.now(),
        },
      },
    });
  },

  invalidateCache: (cellId) => {
    const newCache = { ...get().cache };
    delete newCache[cellId];
    set({ cache: newCache });
  },

  invalidateAll: () => {
    set({ cache: {} });
  },

  addDependency: (cellId, dependencyId) => {
    if (cellId === dependencyId) {
      throw new Error(`Circular reference detected: ${cellId} cannot depend on itself`);
    }

    const graph = get().dependencyGraph;

    if (wouldCreateCycle(graph, cellId, dependencyId)) {
      throw new Error(`Circular reference detected between ${cellId} and ${dependencyId}`);
    }

    const newDependents = new Map(graph.dependents);
    const newDependencies = new Map(graph.dependencies);

    getOrCreateSet(newDependents, dependencyId).add(cellId);
    getOrCreateSet(newDependencies, cellId).add(dependencyId);

    set({
      dependencyGraph: {
        dependents: newDependents,
        dependencies: newDependencies,
      },
    });
  },

  removeDependencies: (cellId) => {
    const graph = get().dependencyGraph;
    const newDependents = new Map(graph.dependents);
    const newDependencies = new Map(graph.dependencies);

    const deps = newDependencies.get(cellId);
    if (deps) {
      for (const dep of deps) {
        const depDependents = newDependents.get(dep);
        if (depDependents) {
          depDependents.delete(cellId);
          if (depDependents.size === 0) {
            newDependents.delete(dep);
          }
        }
      }
      newDependencies.delete(cellId);
    }

    set({
      dependencyGraph: {
        dependents: newDependents,
        dependencies: newDependencies,
      },
    });
  },

  getDependents: (cellId) => {
    const deps = get().dependencyGraph.dependents.get(cellId);
    return deps ? Array.from(deps) : [];
  },

  getDependencies: (cellId) => {
    const deps = get().dependencyGraph.dependencies.get(cellId);
    return deps ? Array.from(deps) : [];
  },

  getAllDependentsRecursive: (cellId) => {
    return getAllDependentsRecursive(get().dependencyGraph, cellId);
  },

  getCalculationOrder: (changedCellId) => {
    const graph = get().dependencyGraph;
    const affected = getAllDependentsRecursive(graph, changedCellId);
    return topologicalSort(graph, [changedCellId, ...affected]).filter(
      (id) => id !== changedCellId
    );
  },

  onCellChange: (cellId, cell) => {
    const state = get();

    if (!cell.formula) {
      state.removeDependencies(cellId);
    }

    state.invalidateCache(cellId);

    const affected = state.getAllDependentsRecursive(cellId);
    const newCache = { ...state.cache };
    for (const affectedId of affected) {
      delete newCache[affectedId];
    }
    set({ cache: newCache });

    try {
      return state.getCalculationOrder(cellId);
    } catch {
      return [];
    }
  },

  hasCell: (cellId) => {
    const graph = get().dependencyGraph;
    return graph.dependencies.has(cellId) || graph.dependents.has(cellId);
  },

  clearGraph: () => {
    set({
      dependencyGraph: {
        dependents: new Map(),
        dependencies: new Map(),
      },
      cache: {},
    });
  },
}));
