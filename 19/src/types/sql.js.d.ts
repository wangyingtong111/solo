declare module 'sql.js' {
  export interface SqlJsStatic {
    Database: typeof Database;
  }

  export class Database {
    constructor(data?: ArrayLike<number> | Buffer | null);
    exec(sql: string, params?: any[]): QueryExecResult[];
    prepare(sql: string): Statement;
    run(sql: string, params?: any[]): Database;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
    create_function(name: string, func: (...args: any[]) => any): Database;
    create_aggregate(name: string, functions: { init?: () => any; step: (state: any, ...args: any[]) => any; finalize: (state: any) => any }): Database;
  }

  export interface Statement {
    bind(params?: any[]): boolean;
    step(): boolean;
    getAsObject(params?: any[]): any;
    get(params?: any[]): any[];
    getColumnNames(): string[];
    free(): boolean;
    reset(): void;
    run(params?: any[]): void;
  }

  export interface QueryExecResult {
    columns: string[];
    values: any[][];
  }

  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string;
  }): Promise<SqlJsStatic>;
}
