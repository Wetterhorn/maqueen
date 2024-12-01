import * as vscode from 'vscode';
import { ActionHolder } from './controller/interfaces';

export type CommandInput = {
    context: vscode.ExtensionContext,
    controller?: ActionHolder
};

export type ListenerInput = {
    sourceId?: string,
    enabled?: boolean,
    progress?: number,
    progressAnimation?: boolean,
    flag?: boolean,
    children?: string []
};

export enum libFileTyp {
    local,
    gitHub
}

export type HashedFiles = {
    label: string,
    hash: string,
    type: libFileTyp,
    enabled: boolean,
    props: {
        date: string,
        url: string
    }
};