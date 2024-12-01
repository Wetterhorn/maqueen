import * as vscode from 'vscode';
import { CustomError, errorType, Exception } from '../exception';

export function getRootPath(context: vscode.ExtensionContext) :string {
    const rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
		? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
    if(!rootPath){
        throw new CustomError('There is no rootPath.',errorType.noWorkspace, 206);
    }
    return rootPath;
}