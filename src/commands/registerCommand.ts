import * as vscode from 'vscode';
import { CommandInput } from '../types';
import { Exception } from '../exception';

export function registerCommands(input: CommandInput, commands: Commands){
    commands.forEach(c=>{
        input.context.subscriptions.push(vscode.commands.registerCommand(c.id, c.action(input)));   
    });
}

export function revealAction(input: CommandInput, actionId: string) {
    const action = input.controller?.getAction(actionId);
    if(action) {
        return action;
    }
    throw new Exception('No action in the CommandInput controller', 203);
}

export type Commands = {id: string,  action: (input: CommandInput) => ((...args: any[]) => any)}[];