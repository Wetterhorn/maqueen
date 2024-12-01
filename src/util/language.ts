import * as vscode from 'vscode';

export function revealText(en: string, de: string): string{
    if(vscode.env.language ==='de'){
        return de;
    }
    return en;
}