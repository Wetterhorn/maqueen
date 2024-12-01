import * as vscode from 'vscode';
import { MutationListener } from '../controller/interfaces';
import { ListenerInput } from '../types';
import { AnimatedItem } from './animatedItem';
import { l10n } from 'vscode';

export class ControlProvider implements vscode.TreeDataProvider<ControlItem>, MutationListener {
    private _onDidChangeTreeData: vscode.EventEmitter<ControlItem | undefined | null | void> = new vscode.EventEmitter<ControlItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ControlItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private showOutput = true;
    constructor() {}
       
    refresh(input:ListenerInput|void): void {
        if(input?.flag !== undefined) {
            this.showOutput = input.flag;
        }
        if(input&&input.progressAnimation!==undefined){
            for(let i = 0; i < this.elements.length; i++){
                if(input.sourceId === this.elements[i].id){
                    this.elements[i].showAnimation(input.progressAnimation === true, ()=>this._onDidChangeTreeData.fire());
                }  
            };
        }
        this._onDidChangeTreeData.fire();
    }
    parentDirectory: string | undefined;

    private elements = [
        new ControlItem('Stop', vscode.TreeItemCollapsibleState.None, {
            command: "maqueen.stop",
            title: l10n.t("Stops a process on the Micro:bit."),
            arguments: []
        }, 'stop-circle', 'stop'),
        new ControlItem('Start', vscode.TreeItemCollapsibleState.None, {
            command: "maqueen.softreboot",
            title: l10n.t("Restarts the program."),
            arguments: []
        }, 'refresh', 'softreboot'),
        new ControlItem('Flash', vscode.TreeItemCollapsibleState.None, {
            command: "maqueen.flashMicrobit",
            title: l10n.t("Flash MicroPython to Micro:bit."),
            arguments: []
        }, 'wrench', 'prep'),
        new ControlItem(l10n.t('Delete'), vscode.TreeItemCollapsibleState.None, {
            command: "maqueen.deleteFilesOnMicrobit",
            title: l10n.t("Deletes all files on Micro:bit."),
            arguments: []
        }, 'trash', 'deleteFilesOnMicrobit'),
        new ControlItem(l10n.t('Eject'), vscode.TreeItemCollapsibleState.None, {
            command: "maqueen.ejectDevice",
            title: l10n.t("Eject Micro:bit"),
            arguments: []
        }, 'arrow-right', 'ejectDevice'),
        new ControlItem(l10n.t('Close port'), vscode.TreeItemCollapsibleState.None, {
            command: "maqueen.closePort",
            title: l10n.t("Closes the port"),
            arguments: []
        }, 'eye-closed', 'closePort'),
        new ControlItem(l10n.t('Send command to Micro:bit'), vscode.TreeItemCollapsibleState.Collapsed,{
            command: "maqueen.sendCommandToMicrobit",
            title: l10n.t("Send command to Micro:bit"),
            arguments: []
        }, 'terminal', 'send')
    ];
    private sendElements = [
        new ControlItem('Ctrl-A', vscode.TreeItemCollapsibleState.None, {
            command: "maqueen.ctrla",
            title: l10n.t("Sets the micro:bit to raw mode."),
            arguments: []
        }, 'send', 'ctrla'),
        new ControlItem('Ctrl-B', vscode.TreeItemCollapsibleState.None, {
            command: "maqueen.ctrlb",
            title: l10n.t("Returns the micro:bit to standard mode."),
            arguments: []
        }, 'send', 'ctrlb'),
        new ControlItem('Ctrl-C', vscode.TreeItemCollapsibleState.None, {
            command: "maqueen.ctrlc",
            title: l10n.t("Stops a process on the Micro:bit."),
            arguments: []
        }, 'send', 'ctrlc'),
        new ControlItem('Ctrl-D', vscode.TreeItemCollapsibleState.None, {
            command: "maqueen.ctrld",
            title: l10n.t("Triggers a soft reset. Is used to restart a programme."),
            arguments: []
        }, 'send', 'Ctrld'),
        new ControlItem('Ctrl-E', vscode.TreeItemCollapsibleState.None, {
            command: "maqueen.ctrle",
            title: l10n.t("Triggers a soft reset. Is used to restart a programme."),
            arguments: []
        }, 'send', 'Ctrle')
    ];
    getTreeItem(element: ControlItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }
    
    getChildren(element?: ControlItem | undefined): vscode.ProviderResult<ControlItem[]> {
        if(element?.id==='send'){
            return this.sendElements;
        } else if(element) {
            return [];
        }
        const config = vscode.workspace.getConfiguration();
        const advancedControl = config.get<boolean>('maqueen.advancedControl', false);
        const es=this.elements.filter(e=>{
            if(e.id==='show'&&(this.showOutput||!advancedControl)){
                return false;
            }
            if(e.id==='hide'&&(!this.showOutput||!advancedControl)){
                return false;
            }
            if(e.id==='closePort'&&!advancedControl){
                return false;
            }
            if(e.id==='send'&&!advancedControl){
                return false;
            }
            if(e.id==='ejectDevice'&&process.platform!=='darwin'){
                return false;
            }
            return true;
        });
        return es;
    }
}

class ControlItem extends AnimatedItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command: vscode.Command,
        icon: string,
        id:string
    ) {
        super(label, collapsibleState);
        this.command = command;
        this.id = id;
        this.iconPath = new vscode.ThemeIcon(icon);
        this.tooltip = command.title;
    }

    //   iconPath = {
    //     light: path.join(__filename, '..', '..', 'resources', 'light', 'dependency.svg'),
    //     dark: path.join(__filename, '..', '..', 'resources', 'dark', 'dependency.svg')
    //   };
}



