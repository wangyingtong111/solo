export var TokenType;
(function (TokenType) {
    TokenType["NUMBER"] = "NUMBER";
    TokenType["STRING"] = "STRING";
    TokenType["IDENTIFIER"] = "IDENTIFIER";
    TokenType["OPERATOR"] = "OPERATOR";
    TokenType["PAREN_LEFT"] = "PAREN_LEFT";
    TokenType["PAREN_RIGHT"] = "PAREN_RIGHT";
    TokenType["COMMA"] = "COMMA";
    TokenType["COLON"] = "COLON";
    TokenType["EXCLAMATION"] = "EXCLAMATION";
    TokenType["EOF"] = "EOF";
})(TokenType || (TokenType = {}));
export var ASTNodeType;
(function (ASTNodeType) {
    ASTNodeType["NUMBER"] = "NUMBER";
    ASTNodeType["STRING"] = "STRING";
    ASTNodeType["CELL_REFERENCE"] = "CELL_REFERENCE";
    ASTNodeType["RANGE_REFERENCE"] = "RANGE_REFERENCE";
    ASTNodeType["BINARY_EXPRESSION"] = "BINARY_EXPRESSION";
    ASTNodeType["UNARY_EXPRESSION"] = "UNARY_EXPRESSION";
    ASTNodeType["FUNCTION_CALL"] = "FUNCTION_CALL";
})(ASTNodeType || (ASTNodeType = {}));
