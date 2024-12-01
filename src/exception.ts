import * as vscode from 'vscode';
import { l10n } from 'vscode';

class VerboseError extends Error{
    static outputChannel = vscode.window.createOutputChannel("MaqueenErrors");
    public readonly verboseErrorMessage: string;
    constructor(verboseErrorMessage: string, message: string){
        super(message);
        this.verboseErrorMessage = verboseErrorMessage;
        const config = vscode.workspace.getConfiguration('maqueen').get<string>('logErrors');
        if(config){
            VerboseError.outputChannel.appendLine(verboseErrorMessage);
        }
    }
}


export class Exception extends VerboseError {
    id = 0;
    constructor(message: string, id: number){
        super(`Exception mit id=${id}: ${message}`, message);
        this.id = id;
        vscode.window.showErrorMessage(`id=${id}: ${message}`);
    }
}

export class CustomError extends VerboseError {
    public readonly type: errorType;
    constructor(message: string, type: errorType, id: number){
        super(`Error mit id=${id}: ${message}`, message);
        this.type = type;
        this.name = 'CustomError';
    }
}

export function forwardError(err: any, message: string, type: errorType, id: number): CustomError {
    if (err instanceof CustomError){
        return err;
    }
    return new CustomError(message, type, id);
}

export enum errorType {
    noMicrobit, // Kein micro:bit gefunden
    moreThanOneMicrobit, // mehr als ein micro:bit gefunden
    noPort, // Es konnte kein Port geöffnet werden.
    fileUpload, //Fehler beim Laden eines Files auf den micro:bit.
    commandExecution, //Fehler bei der Ausführung von Befehlen, die auf micro:bit übertragen werden.
    rawOn, //Fehler beim Überführen des micro:bits in den rawOn-Modus.
    platForm, //Betriebssystem wird nicht unterstützt.
    portClose, //Fehler beim Versuch den Port zu schliessen.
    memmory, //Datei war für den noch verfügbaren Speicher zu gross.
    extLibFileUpload, //externes Bibliotheks-File mit demselben Namen existiert bereits.
    gitHubFile, //Url zu Git Repository hat nicht das richtige Format
    extLibNameCol, //Namenskollision mit internem Bibliotheksfile
    pressResetButton, // Reset-Button am Micro:bit soll gedrückt werden.
    flash, //Problem beim Flashen
    ejectMicrobit, //Problem beim Auswerfen.
    noWorkspace, //Kein Workspace geöffnet.
}

export function getErrorMessage(err: any, includeId: boolean = false): string{
    if(err instanceof Error){
        return includeId ? `${includeId}: ${err.message}`: err.message;
    }
    if(typeof err === 'string') {
        return err;
    }
    if(err instanceof String){
        return err.toString();
    }
    return err.toString();
}

export async function error2user(error: VerboseError){
    let advice = l10n.t('There is no error description for the error that has occurred.');
    if(error instanceof Exception){
        advice = l10n.t({message: 'The following error has occurred:{0}', args: [error.verboseErrorMessage], comment: ['{0} ist eine Fehlermeldung']});
    } else if(error instanceof CustomError) {
        switch(error.type) {
            case errorType.noMicrobit:
                advice = l10n.t('The micro:bit was not found. Check whether it is correctly connected to your laptop with a USB cable.');
                break;
            case errorType.moreThanOneMicrobit:
                advice = l10n.t('You have more than one micro:bit connected to your laptop. Remove one.');
                break;
            case errorType.noPort:
                advice = l10n.t('No connection can be established with the Micro:bit. Check that it is correctly connected to your laptop with a USB cable.');
                break;
            case errorType.fileUpload:
            case errorType.commandExecution:
            case errorType.rawOn:
                advice = l10n.t('There is a problem uploading a Python file to the Micro:bit. Try the following (one after the other):\nCheck whether the Micro:bit is correctly connected to the laptop.\nPress the reset button on the Micro:bit.\nPull out the USB plug and connect again.\nFlash MicroPython to the Micro:bit.');
                break;
            case errorType.platForm:
                advice = l10n.t('Operating system is not supported.');
                break;
            case errorType.portClose:
                advice = l10n.t('Port konnte nicht geschlossen werden.');
                break;
            case errorType.memmory:
                advice = l10n.t('File was too large for the available memory.');
                break;
            case errorType.extLibFileUpload:
                advice = l10n.t('A module file with the same name already exists.');
                break;
            case errorType.extLibNameCol:
                advice = l10n.t('The name is already reserved for an internal module.');
                break;
            case errorType.gitHubFile:
                advice = l10n.t('The URL does not have the correct format.');
                break;
            case errorType.pressResetButton:
                advice = l10n.t('The Micro:bit does not react as desired. Try the following (one after the other):\nPress the reset button on Micro:bit.\nPull out the USB plug and connect again.\nFlash MicroPython to the Micro:bit.');
                break;
            case errorType.flash:
                advice = l10n.t('An error occurred while flashing the Micro:bit.');
                break;
            case errorType.ejectMicrobit:
                advice = l10n.t('An error occurred when ejecting the Micro:bit.');
                break;
            case errorType.noWorkspace:
                advice = l10n.t('No workspace is open.');
                break;
            default:
                advice = l10n.t({message: 'There is no error text for the error type {0}.', args: [error.type], comment:['{0} ist ein Fehlertyp.']});
        }
    }
    const answer = await vscode.window.showErrorMessage(advice);
}
