export var MessageType;
(function (MessageType) {
    MessageType["CONNECTED"] = "CONNECTED";
    MessageType["SYNC"] = "SYNC";
    MessageType["CELL_UPDATE"] = "CELL_UPDATE";
    MessageType["FORMULA_UPDATE"] = "FORMULA_UPDATE";
    MessageType["PRESENCE"] = "PRESENCE";
    MessageType["ACK"] = "ACK";
    MessageType["OFFLINE_CHANGES"] = "OFFLINE_CHANGES";
    MessageType["RECONNECT"] = "RECONNECT";
})(MessageType || (MessageType = {}));
