export class DependencyGraph {
  private dependents: Map<string, Set<string>>;
  private dependencies: Map<string, Set<string>>;

  constructor() {
    this.dependents = new Map();
    this.dependencies = new Map();
  }

  addDependency(cellId: string, dependencyId: string): void {
    if (cellId === dependencyId) {
      throw new Error(`Circular reference detected: ${cellId} cannot depend on itself`);
    }

    if (this.wouldCreateCycle(cellId, dependencyId)) {
      throw new Error(`Circular reference detected between ${cellId} and ${dependencyId}`);
    }

    this.getOrCreateSet(this.dependents, dependencyId).add(cellId);
    this.getOrCreateSet(this.dependencies, cellId).add(dependencyId);
  }

  removeDependencies(cellId: string): void {
    const deps = this.dependencies.get(cellId);
    if (deps) {
      for (const dep of deps) {
        const depDependents = this.dependents.get(dep);
        if (depDependents) {
          depDependents.delete(cellId);
          if (depDependents.size === 0) {
            this.dependents.delete(dep);
          }
        }
      }
      this.dependencies.delete(cellId);
    }
  }

  getDependents(cellId: string): string[] {
    const deps = this.dependents.get(cellId);
    return deps ? Array.from(deps) : [];
  }

  getDependencies(cellId: string): string[] {
    const deps = this.dependencies.get(cellId);
    return deps ? Array.from(deps) : [];
  }

  getAllDependentsRecursive(cellId: string): string[] {
    const visited = new Set<string>();
    const result: string[] = [];
    const queue: string[] = [cellId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const dependents = this.getDependents(current);
      
      for (const dep of dependents) {
        if (!visited.has(dep)) {
          visited.add(dep);
          result.push(dep);
          queue.push(dep);
        }
      }
    }

    return result;
  }

  topologicalSort(startCells: string[]): string[] {
    const inDegree = new Map<string, number>();
    const queue: string[] = [];
    const result: string[] = [];
    const visited = new Set<string>();

    const allCells = new Set<string>();
    for (const cell of startCells) {
      allCells.add(cell);
      for (const dep of this.getAllDependentsRecursive(cell)) {
        allCells.add(dep);
      }
    }

    for (const cell of allCells) {
      const deps = this.getDependencies(cell);
      const relevantDeps = deps.filter(d => allCells.has(d));
      inDegree.set(cell, relevantDeps.length);
      if (relevantDeps.length === 0) {
        queue.push(cell);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (!visited.has(current)) {
        visited.add(current);
        if (startCells.includes(current) || this.hasDependencyInSet(current, startCells)) {
          result.push(current);
        }

        const dependents = this.getDependents(current);
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

    if (result.length !== allCells.size) {
      throw new Error('Circular reference detected in dependency graph');
    }

    return result;
  }

  getCalculationOrder(changedCellId: string): string[] {
    const affected = this.getAllDependentsRecursive(changedCellId);
    return this.topologicalSort([changedCellId, ...affected]).filter(id => id !== changedCellId);
  }

  clear(): void {
    this.dependents.clear();
    this.dependencies.clear();
  }

  hasCell(cellId: string): boolean {
    return this.dependencies.has(cellId) || this.dependents.has(cellId);
  }

  private getOrCreateSet(map: Map<string, Set<string>>, key: string): Set<string> {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    return set;
  }

  private wouldCreateCycle(cellId: string, dependencyId: string): boolean {
    const visited = new Set<string>();
    const stack: string[] = [dependencyId];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === cellId) {
        return true;
      }
      if (!visited.has(current)) {
        visited.add(current);
        const deps = this.getDependencies(current);
        for (const dep of deps) {
          stack.push(dep);
        }
      }
    }

    return false;
  }

  private hasDependencyInSet(cellId: string, set: string[]): boolean {
    const deps = this.getDependencies(cellId);
    for (const dep of deps) {
      if (set.includes(dep)) {
        return true;
      }
      if (this.hasDependencyInSet(dep, set)) {
        return true;
      }
    }
    return false;
  }
}
