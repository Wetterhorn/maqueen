import * as vscode from 'vscode';
import { registerCommands, Commands, revealAction } from './registerCommand';
import { CommandInput } from '../types';

const commands: Commands = [
    {//Öffnet File im VS Code Editor
        id: 'maqueen.openWorkspace',
        action: (input: CommandInput)=>() => {
            vscode.commands.executeCommand('vscode.openFolder');
        }
    },
    {//Öffnet File im VS Code Editor
        id: 'maqueen.createProject',
        action: (input: CommandInput)=>revealAction(input, 'createProject')
    }
];

export function registerWorkspaceCommands(commandInput: CommandInput){
    registerCommands(commandInput, commands);
}