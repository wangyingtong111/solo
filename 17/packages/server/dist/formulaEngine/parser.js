import { TokenType, ASTNodeType, } from './types.js';
const OPERATORS = new Set(['+', '-', '*', '/', '^', '=', '<>', '<', '>', '<=', '>=', '&']);
export class Tokenizer {
    input;
    position;
    constructor(input) {
        this.input = input.startsWith('=') ? input.slice(1) : input;
        this.position = 0;
    }
    tokenize() {
        const tokens = [];
        while (this.position < this.input.length) {
            const char = this.input[this.position];
            if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
                this.position++;
                continue;
            }
            if (char === '"') {
                tokens.push(this.readString());
                continue;
            }
            if (this.isDigit(char) || (char === '.' && this.isDigit(this.input[this.position + 1]))) {
                tokens.push(this.readNumber());
                continue;
            }
            if (this.isLetter(char) || char === '_') {
                tokens.push(this.readIdentifier());
                continue;
            }
            if (char === '(') {
                tokens.push({ type: TokenType.PAREN_LEFT, value: '(', position: this.position });
                this.position++;
                continue;
            }
            if (char === ')') {
                tokens.push({ type: TokenType.PAREN_RIGHT, value: ')', position: this.position });
                this.position++;
                continue;
            }
            if (char === ',') {
                tokens.push({ type: TokenType.COMMA, value: ',', position: this.position });
                this.position++;
                continue;
            }
            if (char === ':') {
                tokens.push({ type: TokenType.COLON, value: ':', position: this.position });
                this.position++;
                continue;
            }
            if (char === '!') {
                tokens.push({ type: TokenType.EXCLAMATION, value: '!', position: this.position });
                this.position++;
                continue;
            }
            const operatorToken = this.readOperator();
            if (operatorToken) {
                tokens.push(operatorToken);
                continue;
            }
            throw new Error(`Unexpected character '${char}' at position ${this.position}`);
        }
        tokens.push({ type: TokenType.EOF, value: '', position: this.position });
        return tokens;
    }
    readString() {
        const start = this.position;
        this.position++;
        let value = '';
        while (this.position < this.input.length) {
            const char = this.input[this.position];
            if (char === '"') {
                if (this.input[this.position + 1] === '"') {
                    value += '"';
                    this.position += 2;
                }
                else {
                    this.position++;
                    break;
                }
            }
            else {
                value += char;
                this.position++;
            }
        }
        return { type: TokenType.STRING, value, position: start };
    }
    readNumber() {
        const start = this.position;
        let value = '';
        let hasDecimal = false;
        while (this.position < this.input.length) {
            const char = this.input[this.position];
            if (this.isDigit(char)) {
                value += char;
                this.position++;
            }
            else if (char === '.' && !hasDecimal) {
                value += char;
                hasDecimal = true;
                this.position++;
            }
            else {
                break;
            }
        }
        return { type: TokenType.NUMBER, value, position: start };
    }
    readIdentifier() {
        const start = this.position;
        let value = '';
        while (this.position < this.input.length) {
            const char = this.input[this.position];
            if (this.isLetter(char) || this.isDigit(char) || char === '_') {
                value += char;
                this.position++;
            }
            else {
                break;
            }
        }
        return { type: TokenType.IDENTIFIER, value, position: start };
    }
    readOperator() {
        const start = this.position;
        const twoChar = this.input.slice(this.position, this.position + 2);
        if (OPERATORS.has(twoChar)) {
            this.position += 2;
            return { type: TokenType.OPERATOR, value: twoChar, position: start };
        }
        const char = this.input[this.position];
        if (OPERATORS.has(char)) {
            this.position++;
            return { type: TokenType.OPERATOR, value: char, position: start };
        }
        return null;
    }
    isDigit(char) {
        return char >= '0' && char <= '9';
    }
    isLetter(char) {
        return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
    }
}
export class Parser {
    tokens;
    current;
    defaultSheetName;
    constructor(tokens, defaultSheetName = 'Sheet1') {
        this.tokens = tokens;
        this.current = 0;
        this.defaultSheetName = defaultSheetName;
    }
    parse() {
        const ast = this.parseExpression();
        this.expect(TokenType.EOF);
        return ast;
    }
    parseExpression() {
        return this.parseComparison();
    }
    parseComparison() {
        let left = this.parseTerm();
        while (this.match(TokenType.OPERATOR) && ['=', '<>', '<', '>', '<=', '>='].includes(this.peek().value)) {
            const operator = this.consume(TokenType.OPERATOR).value;
            const right = this.parseTerm();
            left = {
                type: ASTNodeType.BINARY_EXPRESSION,
                operator,
                left,
                right,
            };
        }
        return left;
    }
    parseTerm() {
        let left = this.parseFactor();
        while (this.match(TokenType.OPERATOR) && ['+', '-', '&'].includes(this.peek().value)) {
            const operator = this.consume(TokenType.OPERATOR).value;
            const right = this.parseFactor();
            left = {
                type: ASTNodeType.BINARY_EXPRESSION,
                operator,
                left,
                right,
            };
        }
        return left;
    }
    parseFactor() {
        let left = this.parsePower();
        while (this.match(TokenType.OPERATOR) && ['*', '/'].includes(this.peek().value)) {
            const operator = this.consume(TokenType.OPERATOR).value;
            const right = this.parsePower();
            left = {
                type: ASTNodeType.BINARY_EXPRESSION,
                operator,
                left,
                right,
            };
        }
        return left;
    }
    parsePower() {
        let left = this.parseUnary();
        while (this.match(TokenType.OPERATOR) && this.peek().value === '^') {
            const operator = this.consume(TokenType.OPERATOR).value;
            const right = this.parseUnary();
            left = {
                type: ASTNodeType.BINARY_EXPRESSION,
                operator,
                left,
                right,
            };
        }
        return left;
    }
    parseUnary() {
        if (this.match(TokenType.OPERATOR) && ['+', '-'].includes(this.peek().value)) {
            const operator = this.consume(TokenType.OPERATOR).value;
            const operand = this.parseUnary();
            return {
                type: ASTNodeType.UNARY_EXPRESSION,
                operator,
                operand,
            };
        }
        return this.parsePrimary();
    }
    parsePrimary() {
        if (this.match(TokenType.NUMBER)) {
            const token = this.consume(TokenType.NUMBER);
            return {
                type: ASTNodeType.NUMBER,
                value: parseFloat(token.value),
            };
        }
        if (this.match(TokenType.STRING)) {
            const token = this.consume(TokenType.STRING);
            return {
                type: ASTNodeType.STRING,
                value: token.value,
            };
        }
        if (this.match(TokenType.PAREN_LEFT)) {
            this.consume(TokenType.PAREN_LEFT);
            const expression = this.parseExpression();
            this.consume(TokenType.PAREN_RIGHT);
            return expression;
        }
        if (this.match(TokenType.IDENTIFIER)) {
            return this.parseIdentifierOrCell();
        }
        throw new Error(`Unexpected token '${this.peek().value}' at position ${this.peek().position}`);
    }
    parseIdentifierOrCell() {
        const token = this.peek();
        const value = token.value;
        if (this.isCellReference(value)) {
            return this.parseCellOrRange();
        }
        const nextToken = this.tokens[this.current + 1];
        if (nextToken && nextToken.type === TokenType.PAREN_LEFT) {
            return this.parseFunctionCall();
        }
        return this.parseCellOrRange();
    }
    parseCellOrRange() {
        let sheetName;
        if (this.tokens[this.current + 1]?.type === TokenType.EXCLAMATION) {
            sheetName = this.consume(TokenType.IDENTIFIER).value;
            this.consume(TokenType.EXCLAMATION);
        }
        const startToken = this.consume(TokenType.IDENTIFIER);
        const { column: startCol, row: startRow } = this.parseCellReference(startToken.value);
        const startCellId = this.getCellId(sheetName, startCol, startRow);
        if (this.match(TokenType.COLON)) {
            this.consume(TokenType.COLON);
            const endToken = this.consume(TokenType.IDENTIFIER);
            const { column: endCol, row: endRow } = this.parseCellReference(endToken.value);
            const endCellId = this.getCellId(sheetName, endCol, endRow);
            return {
                type: ASTNodeType.RANGE_REFERENCE,
                sheetName,
                startColumn: startCol,
                startRow,
                endColumn: endCol,
                endRow,
                startCellId,
                endCellId,
            };
        }
        return {
            type: ASTNodeType.CELL_REFERENCE,
            sheetName,
            column: startCol,
            row: startRow,
            cellId: startCellId,
        };
    }
    parseFunctionCall() {
        const name = this.consume(TokenType.IDENTIFIER).value;
        this.consume(TokenType.PAREN_LEFT);
        const args = [];
        if (!this.match(TokenType.PAREN_RIGHT)) {
            args.push(this.parseExpression());
            while (this.match(TokenType.COMMA)) {
                this.consume(TokenType.COMMA);
                args.push(this.parseExpression());
            }
        }
        this.consume(TokenType.PAREN_RIGHT);
        return {
            type: ASTNodeType.FUNCTION_CALL,
            name,
            arguments: args,
        };
    }
    parseCellReference(value) {
        const match = value.match(/^([A-Za-z]+)(\d+)$/);
        if (!match) {
            throw new Error(`Invalid cell reference: ${value}`);
        }
        return { column: match[1].toUpperCase(), row: parseInt(match[2], 10) };
    }
    isCellReference(value) {
        return /^[A-Za-z]+\d+$/.test(value);
    }
    getCellId(sheetName, column, row) {
        const sheet = sheetName || this.defaultSheetName;
        return `${sheet}!${column}${row}`;
    }
    peek() {
        return this.tokens[this.current];
    }
    match(type) {
        return this.current < this.tokens.length && this.tokens[this.current].type === type;
    }
    consume(type) {
        if (this.match(type)) {
            return this.tokens[this.current++];
        }
        throw new Error(`Expected token type ${type}, got ${this.peek().type} at position ${this.peek().position}`);
    }
    expect(type) {
        if (!this.match(type)) {
            throw new Error(`Expected token type ${type}, got ${this.peek().type} at position ${this.peek().position}`);
        }
    }
}
export function parseFormula(formula, defaultSheetName = 'Sheet1') {
    const tokenizer = new Tokenizer(formula);
    const tokens = tokenizer.tokenize();
    const parser = new Parser(tokens, defaultSheetName);
    return parser.parse();
}
