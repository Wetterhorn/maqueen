import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

/**
 * Fehlertypen fürs Logfile
 */
export enum ErrorType {
    USER = "UserError",
    CONNECTION = "ConnectionError",
    NETWORK = "NetworkError",
    CONFIG = "ConfigError",
    UNKNOWN = "UnknownError",
    ACTION = "UserAction",
    EXECUTE = "ExecuteError"
}

export class ErrorLogger {
    private static instance: ErrorLogger;
    private extensionPath?: string;
    private errorLogPath?: string;

    private constructor() {}

    /**
     * Singleton-Instanz holen
     */
    public static getInstance(): ErrorLogger {
        if (!ErrorLogger.instance) {
            ErrorLogger.instance = new ErrorLogger();
        }
        return ErrorLogger.instance;
    }

    /**
     * Initialisiert die Umgebung mit dem Context aus activate()
     */
    public init(context: vscode.ExtensionContext) {
        this.extensionPath = context.extensionPath;
        this.prepareErrorLog();
    }

    /**
     * Schreibt einen Fehler ins Logfile
     */
    public logError(type: ErrorType, message: string, err?: unknown) {
        if (!this.errorLogPath) {
            this.prepareErrorLog();
        }
        const timestamp = new Date().toISOString();
        let fullMessage = `[${timestamp}] [${type}] ${message}`;
        if (err instanceof Error) {
            fullMessage += `\n${err.stack}`;
        } else if (err) {
            fullMessage += `\n${JSON.stringify(err, null, 2)}`;
        }
        fullMessage += "\n\n";

        fs.appendFileSync(this.errorLogPath!, fullMessage, { encoding: "utf8" });
    }

    private prepareErrorLog() {
        if (!this.extensionPath) {
            return;
        }
        const logDir = path.join(this.extensionPath, "logs");
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        this.errorLogPath = path.join(logDir, "error.log");
    }
}

export function logError(type: ErrorType, message: string, err?: unknown){
    if(err){
    ErrorLogger.getInstance().logError(type, message, err);
    } else {
        ErrorLogger.getInstance().logError(type, message);
    }
    
}
