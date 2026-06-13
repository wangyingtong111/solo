import { parseFormula } from './parser.js';
import { DependencyGraph } from './DependencyGraph.js';
import { ASTNodeType, } from './types.js';
export class FormulaEngine {
    functions;
    dependencyGraph;
    cellValues;
    formulas;
    constructor() {
        this.functions = new Map();
        this.dependencyGraph = new DependencyGraph();
        this.cellValues = new Map();
        this.formulas = new Map();
        this.registerBuiltInFunctions();
    }
    registerFunction(definition) {
        if (this.functions.has(definition.name.toUpperCase())) {
            throw new Error(`Function ${definition.name} is already registered`);
        }
        this.functions.set(definition.name.toUpperCase(), definition);
    }
    getFunction(name) {
        return this.functions.get(name.toUpperCase());
    }
    parseAndEvaluate(formula, cellId, cellValues = this.cellValues, defaultSheetName = 'Sheet1') {
        try {
            const ast = parseFormula(formula, defaultSheetName);
            const dependencies = this.extractDependencies(ast);
            this.dependencyGraph.removeDependencies(cellId);
            for (const dep of dependencies) {
                if (dep !== cellId) {
                    this.dependencyGraph.addDependency(cellId, dep);
                }
            }
            const value = this.evaluateAST(ast, cellValues);
            this.cellValues.set(cellId, value);
            this.formulas.set(cellId, formula);
            return { value, dependencies, error: undefined };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.cellValues.set(cellId, `#ERROR: ${errorMessage}`);
            return {
                value: `#ERROR: ${errorMessage}`,
                dependencies: [],
                error: errorMessage,
            };
        }
    }
    onCellChange(cellId, newValue) {
        this.cellValues.set(cellId, newValue);
        const updatedCells = [];
        const errors = new Map();
        try {
            const calculationOrder = this.dependencyGraph.getCalculationOrder(cellId);
            for (const dependentCell of calculationOrder) {
                const formula = this.formulas.get(dependentCell);
                if (formula) {
                    try {
                        const ast = parseFormula(formula, this.extractSheetName(dependentCell));
                        const value = this.evaluateAST(ast, this.cellValues);
                        this.cellValues.set(dependentCell, value);
                        updatedCells.push(dependentCell);
                    }
                    catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        this.cellValues.set(dependentCell, `#ERROR: ${errorMessage}`);
                        errors.set(dependentCell, errorMessage);
                    }
                }
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            errors.set(cellId, errorMessage);
        }
        return { updatedCells, errors };
    }
    getCellValue(cellId) {
        return this.cellValues.get(cellId) ?? null;
    }
    setCellValue(cellId, value) {
        this.cellValues.set(cellId, value);
    }
    getCellFormula(cellId) {
        return this.formulas.get(cellId);
    }
    removeCell(cellId) {
        this.cellValues.delete(cellId);
        this.formulas.delete(cellId);
        this.dependencyGraph.removeDependencies(cellId);
    }
    clearAll() {
        this.cellValues.clear();
        this.formulas.clear();
        this.dependencyGraph.clear();
    }
    getDependencyGraph() {
        return this.dependencyGraph;
    }
    registerBuiltInFunctions() {
        this.registerFunction({
            name: 'SUM',
            minArgs: 1,
            maxArgs: Infinity,
            evaluate: (args) => {
                return this.flattenArgs(args).reduce((sum, val) => sum + this.toNumber(val), 0);
            },
        });
        this.registerFunction({
            name: 'AVG',
            minArgs: 1,
            maxArgs: Infinity,
            evaluate: (args) => {
                const values = this.flattenArgs(args).filter(v => v !== null && v !== '');
                if (values.length === 0)
                    return 0;
                return values.reduce((sum, val) => sum + this.toNumber(val), 0) / values.length;
            },
        });
        this.registerFunction({
            name: 'COUNT',
            minArgs: 1,
            maxArgs: Infinity,
            evaluate: (args) => {
                return this.flattenArgs(args).filter(v => typeof v === 'number' && !isNaN(v)).length;
            },
        });
        this.registerFunction({
            name: 'IF',
            minArgs: 2,
            maxArgs: 3,
            evaluate: (args) => {
                const condition = this.toBoolean(args[0]);
                return condition ? args[1] : (args.length > 2 ? args[2] : false);
            },
        });
        this.registerFunction({
            name: 'VLOOKUP',
            minArgs: 3,
            maxArgs: 4,
            evaluate: (args) => {
                const lookupValue = args[0];
                const tableArray = args[1];
                const colIndexNum = this.toNumber(args[2]);
                const rangeLookup = args.length > 3 ? this.toBoolean(args[3]) : true;
                if (!Array.isArray(tableArray)) {
                    throw new Error('VLOOKUP: second argument must be a range');
                }
                const values = tableArray;
                const rowCount = Math.floor(values.length / 2);
                for (let i = 0; i < rowCount; i++) {
                    const currentValue = values[i];
                    if (rangeLookup) {
                        if (currentValue > this.toNumber(lookupValue)) {
                            if (i === 0)
                                throw new Error('VLOOKUP: value not found');
                            return values[(i - 1) + (colIndexNum - 1) * rowCount];
                        }
                        if (i === rowCount - 1) {
                            return values[i + (colIndexNum - 1) * rowCount];
                        }
                    }
                    else {
                        if (currentValue === this.toNumber(lookupValue)) {
                            return values[i + (colIndexNum - 1) * rowCount];
                        }
                    }
                }
                throw new Error('VLOOKUP: value not found');
            },
        });
        this.registerFunction({
            name: 'CONCAT',
            minArgs: 1,
            maxArgs: Infinity,
            evaluate: (args) => {
                return this.flattenArgs(args)
                    .map(v => v === null || v === undefined ? '' : String(v))
                    .join('');
            },
        });
    }
    evaluateAST(ast, cellValues) {
        switch (ast.type) {
            case ASTNodeType.NUMBER:
                return ast.value;
            case ASTNodeType.STRING:
                return ast.value;
            case ASTNodeType.CELL_REFERENCE: {
                const cell = ast;
                return this.resolveCellValue(cell.cellId, cellValues);
            }
            case ASTNodeType.RANGE_REFERENCE: {
                const range = ast;
                return this.expandRange(range);
            }
            case ASTNodeType.UNARY_EXPRESSION: {
                const operand = this.evaluateAST(ast.operand, cellValues);
                if (ast.operator === '-') {
                    return -this.toNumber(operand);
                }
                return this.toNumber(operand);
            }
            case ASTNodeType.BINARY_EXPRESSION: {
                const left = this.evaluateAST(ast.left, cellValues);
                const right = this.evaluateAST(ast.right, cellValues);
                return this.evaluateBinaryExpression(ast.operator, left, right);
            }
            case ASTNodeType.FUNCTION_CALL: {
                const func = this.getFunction(ast.name);
                if (!func) {
                    throw new Error(`Unknown function: ${ast.name}`);
                }
                const args = ast.arguments.map((arg) => this.evaluateAST(arg, cellValues));
                if (args.length < func.minArgs) {
                    throw new Error(`Function ${ast.name} requires at least ${func.minArgs} arguments`);
                }
                if (args.length > func.maxArgs) {
                    throw new Error(`Function ${ast.name} accepts at most ${func.maxArgs} arguments`);
                }
                return func.evaluate(args);
            }
            default:
                throw new Error(`Unknown AST node type: ${ast.type}`);
        }
    }
    evaluateBinaryExpression(operator, left, right) {
        switch (operator) {
            case '+':
                return this.toNumber(left) + this.toNumber(right);
            case '-':
                return this.toNumber(left) - this.toNumber(right);
            case '*':
                return this.toNumber(left) * this.toNumber(right);
            case '/': {
                const divisor = this.toNumber(right);
                if (divisor === 0)
                    throw new Error('Division by zero');
                return this.toNumber(left) / divisor;
            }
            case '^':
                return Math.pow(this.toNumber(left), this.toNumber(right));
            case '&':
                return String(left) + String(right);
            case '=':
                return this.compareValues(left, right) === 0;
            case '<>':
                return this.compareValues(left, right) !== 0;
            case '<':
                return this.compareValues(left, right) < 0;
            case '>':
                return this.compareValues(left, right) > 0;
            case '<=':
                return this.compareValues(left, right) <= 0;
            case '>=':
                return this.compareValues(left, right) >= 0;
            default:
                throw new Error(`Unknown operator: ${operator}`);
        }
    }
    compareValues(left, right) {
        if (typeof left === 'number' && typeof right === 'number') {
            return left - right;
        }
        const leftStr = String(left);
        const rightStr = String(right);
        return leftStr.localeCompare(rightStr);
    }
    resolveCellValue(cellId, cellValues) {
        const value = cellValues.get(cellId);
        if (value === undefined) {
            return 0;
        }
        if (typeof value === 'string' && value.startsWith('#ERROR')) {
            throw new Error(value.slice(8));
        }
        return value;
    }
    expandRange(range) {
        const values = [];
        const sheetName = range.sheetName || 'Sheet1';
        const startColIndex = this.columnToIndex(range.startColumn);
        const endColIndex = this.columnToIndex(range.endColumn);
        const startRow = range.startRow;
        const endRow = range.endRow;
        for (let col = startColIndex; col <= endColIndex; col++) {
            for (let row = startRow; row <= endRow; row++) {
                const cellId = `${sheetName}!${this.indexToColumn(col)}${row}`;
                const value = this.cellValues.get(cellId);
                values.push(typeof value === 'number' ? value : 0);
            }
        }
        return values;
    }
    extractDependencies(ast) {
        const dependencies = [];
        const visited = new Set();
        const traverse = (node) => {
            switch (node.type) {
                case ASTNodeType.CELL_REFERENCE: {
                    const cell = node;
                    if (!visited.has(cell.cellId)) {
                        visited.add(cell.cellId);
                        dependencies.push(cell.cellId);
                    }
                    break;
                }
                case ASTNodeType.RANGE_REFERENCE: {
                    const range = node;
                    const sheetName = range.sheetName || 'Sheet1';
                    const startColIndex = this.columnToIndex(range.startColumn);
                    const endColIndex = this.columnToIndex(range.endColumn);
                    for (let col = startColIndex; col <= endColIndex; col++) {
                        for (let row = range.startRow; row <= range.endRow; row++) {
                            const cellId = `${sheetName}!${this.indexToColumn(col)}${row}`;
                            if (!visited.has(cellId)) {
                                visited.add(cellId);
                                dependencies.push(cellId);
                            }
                        }
                    }
                    break;
                }
                case ASTNodeType.BINARY_EXPRESSION:
                    traverse(node.left);
                    traverse(node.right);
                    break;
                case ASTNodeType.UNARY_EXPRESSION:
                    traverse(node.operand);
                    break;
                case ASTNodeType.FUNCTION_CALL:
                    node.arguments.forEach(traverse);
                    break;
            }
        };
        traverse(ast);
        return dependencies;
    }
    flattenArgs(args) {
        const result = [];
        for (const arg of args) {
            if (Array.isArray(arg)) {
                result.push(...arg);
            }
            else {
                result.push(arg);
            }
        }
        return result;
    }
    toNumber(value) {
        if (value === null || value === undefined || value === '')
            return 0;
        if (typeof value === 'boolean')
            return value ? 1 : 0;
        if (typeof value === 'number')
            return value;
        const num = parseFloat(String(value));
        return isNaN(num) ? 0 : num;
    }
    toBoolean(value) {
        if (value === null || value === undefined || value === '')
            return false;
        if (typeof value === 'boolean')
            return value;
        if (typeof value === 'number')
            return value !== 0;
        const str = String(value).toLowerCase();
        return str !== 'false' && str !== '0' && str !== '';
    }
    columnToIndex(column) {
        let index = 0;
        for (let i = 0; i < column.length; i++) {
            index = index * 26 + (column.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
        }
        return index;
    }
    indexToColumn(index) {
        let column = '';
        let remaining = index;
        while (remaining > 0) {
            const mod = (remaining - 1) % 26;
            column = String.fromCharCode('A'.charCodeAt(0) + mod) + column;
            remaining = Math.floor((remaining - 1) / 26);
        }
        return column;
    }
    extractSheetName(cellId) {
        const parts = cellId.split('!');
        return parts.length > 1 ? parts[0] : 'Sheet1';
    }
}
