export enum TokenType {
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  IDENTIFIER = 'IDENTIFIER',
  OPERATOR = 'OPERATOR',
  PAREN_LEFT = 'PAREN_LEFT',
  PAREN_RIGHT = 'PAREN_RIGHT',
  COMMA = 'COMMA',
  COLON = 'COLON',
  EXCLAMATION = 'EXCLAMATION',
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

export enum ASTNodeType {
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  CELL_REFERENCE = 'CELL_REFERENCE',
  RANGE_REFERENCE = 'RANGE_REFERENCE',
  BINARY_EXPRESSION = 'BINARY_EXPRESSION',
  UNARY_EXPRESSION = 'UNARY_EXPRESSION',
  FUNCTION_CALL = 'FUNCTION_CALL',
}

export interface BaseASTNode {
  type: ASTNodeType;
}

export interface NumberNode extends BaseASTNode {
  type: ASTNodeType.NUMBER;
  value: number;
}

export interface StringNode extends BaseASTNode {
  type: ASTNodeType.STRING;
  value: string;
}

export interface CellReferenceNode extends BaseASTNode {
  type: ASTNodeType.CELL_REFERENCE;
  sheetName?: string;
  column: string;
  row: number;
  cellId: string;
}

export interface RangeReferenceNode extends BaseASTNode {
  type: ASTNodeType.RANGE_REFERENCE;
  sheetName?: string;
  startColumn: string;
  startRow: number;
  endColumn: string;
  endRow: number;
  startCellId: string;
  endCellId: string;
}

export interface BinaryExpressionNode extends BaseASTNode {
  type: ASTNodeType.BINARY_EXPRESSION;
  operator: string;
  left: ASTNode;
  right: ASTNode;
}

export interface UnaryExpressionNode extends BaseASTNode {
  type: ASTNodeType.UNARY_EXPRESSION;
  operator: string;
  operand: ASTNode;
}

export interface FunctionCallNode extends BaseASTNode {
  type: ASTNodeType.FUNCTION_CALL;
  name: string;
  arguments: ASTNode[];
}

export type ASTNode =
  | NumberNode
  | StringNode
  | CellReferenceNode
  | RangeReferenceNode
  | BinaryExpressionNode
  | UnaryExpressionNode
  | FunctionCallNode;

export type FunctionArgument = number | string | boolean | null | number[];

export interface FunctionDefinition {
  name: string;
  minArgs: number;
  maxArgs: number;
  evaluate: (args: FunctionArgument[]) => FunctionArgument;
}

export interface CellPosition {
  sheetName: string;
  column: string;
  row: number;
}

export interface EvaluationResult {
  value: FunctionArgument;
  dependencies: string[];
  error?: string;
}

export interface CellChangeResult {
  updatedCells: string[];
  errors: Map<string, string>;
}
