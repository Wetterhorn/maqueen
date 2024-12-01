import * as vscode from 'vscode';
import { registerCommands, Commands, revealAction } from './registerCommand';
import { CommandInput } from '../types';
import { Exception } from '../exception';
import path from 'path';
import { File } from '../treeDataProvider/fileProvider';
import { getRootPath } from '../util/pathHelper';
import { l10n } from 'vscode';

const fileCommands: Commands = [
    {//Öffnet File im VS Code Editor
        id: 'maqueen.openFile',
        action: (input: CommandInput)=>(fileUri: vscode.Uri) => {
            vscode.workspace.openTextDocument(fileUri).then((document) => {
                const editor = vscode.window.showTextDocument(document);
            });
        }
    },
    {//Erzeugt neues File im Verzeichnis src/main
        id: 'maqueen.createMainFile',
        action: (input: CommandInput) => createFile(input, path.join('src', 'main'))
    },
    {//Erzeugt neues File im Verzeichnis src
        id: 'maqueen.createModFile',
        action: (input: CommandInput) => createFile(input, 'src')
    },
    {//Löscht ein File
        id: 'maqueen.deleteFile',
        action: (input: CommandInput)=>deleteFile()
    },
    {//Löscht ein File
        id: 'maqueen.renameFile',
        action: (input: CommandInput)=>renameFile(input)
    }
];

export function registerFileCommands(commandInput: CommandInput){
    registerCommands(commandInput, fileCommands);
}

//Hilfsfunktionen

//Erzeugt ein File
function createFile(commandInput: CommandInput, root: string) {
    return async () => {
        const rootPath = getRootPath(commandInput.context);
        let fileName = await vscode.window.showInputBox({
            prompt: l10n.t("Enter the name of the new file."),
            placeHolder: l10n.t("Filename"),
        });
        if (!fileName) {
            vscode.window.showErrorMessage(l10n.t('Filename is required.'));
            return;
        }
        const name = checkFileName(fileName);
        if(!name){
            vscode.window.showErrorMessage(l10n.t("The file name may only contain numbers, the letters a-z and A-Z and the characters ‘-’ and ‘_’."));
            return; 
        } else {
            fileName = name+'.py';
        }
        const filePath = path.join(rootPath, root, fileName);
        try {
            // Erstelle die neue Datei (leerer Inhalt), falls Datei nicht schon existiert
            const fileUri = vscode.Uri.file(filePath);
            try{
                await vscode.workspace.fs.stat(fileUri);
                vscode.window.showErrorMessage(l10n.t({message: 'The file {0} already exists.', args: [fileName], comment: ['{0} ist der Name der Datei']}));
                return; 
            } catch(err: any){}
            await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());
            
            // Zeige eine Erfolgsmeldung
            //vscode.window.showInformationMessage(revealText(`File ${fileName} has been created.`,`Datei ${fileName} wurde erstellt.`));
    
            // Öffne die neu erstellte Datei im Editor
            const document = await vscode.workspace.openTextDocument(filePath);
            vscode.window.showTextDocument(document);
        } catch (error:any) {
            throw new Exception(error.message, 101);
        }
    };
}

function deleteFile(){
    return async (p: File) => {
        const message = vscode.l10n.t({message: 'Should the file {0} actually be deleted?', args: [p.label], comment: ['{0} ist eine Datei.']});
        const yes = l10n.t('Yes');
        const userResponse = await vscode.window.showInformationMessage(
            message,
            { modal: true }, // modal makes the prompt blocking
            yes,
        );
        if(userResponse === yes){
            try{
                await vscode.workspace.fs.delete(vscode.Uri.file(p.path)); 
            } catch(err){
                throw new Exception(`The file ${p.path} could not be deleted.`,102);
            }
            
        }
    }; 
}

function renameFile(commandInput: CommandInput) {
    return async (p: File) => {
        let fileName = await vscode.window.showInputBox({
            prompt: l10n.t("Enter the new name of the file."),
            placeHolder: l10n.t("Filename"),
        });
        if (!fileName) {
            vscode.window.showErrorMessage(l10n.t('The file name is required.'));
            return;
        }
        const name = checkFileName(fileName);
        if(!name){
            vscode.window.showErrorMessage(l10n.t("The file name may only contain numbers, the letters a-z and A-Z and the characters ‘-’ and ‘_’."));
            return; 
        } else {
            fileName = name;
        }
        try {
            // Erstelle die neue Datei (leerer Inhalt), falls Datei nicht schon existiert
            const fileUri = vscode.Uri.joinPath(vscode.Uri.file(p.path), '..', fileName+'.py');
            if(fileName+'.py'!==p.label){
                try{
                    await vscode.workspace.fs.stat(fileUri);
                    vscode.window.showErrorMessage(l10n.t({message: 'The file {0} already exists.', args: [fileName], comment: ['{0} ist der Dateiname']}));
                    return; 
                } catch(err: any){}
                await vscode.workspace.fs.rename(vscode.Uri.file(p.path), fileUri);
            }
    
            // Öffne die neu erstellte Datei im Editor
            const document = await vscode.workspace.openTextDocument(fileUri.fsPath);
            vscode.window.showTextDocument(document);
        } catch (error:any) {
            throw new Exception(error.message, 103);
        }
    };
}

function checkFileName(fileName: string):undefined | string{
    const matchWithSuffix = fileName.match(/^[a-zA-Z_\-0-9]+.[a-zA-Z]+$/);
    const matchWithoutSuffix = fileName.match(/^[a-zA-Z_\-0-9]+$/);
    const matchBeforDot = fileName.match(/^[a-zA-Z_\-0-9]+/);
    if(!matchWithSuffix&&!matchWithoutSuffix||!matchBeforDot){
        return undefined;
    } else {
        return matchBeforDot[0];
    }
}