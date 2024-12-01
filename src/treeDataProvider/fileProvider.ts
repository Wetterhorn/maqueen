import * as vscode from 'vscode';
import * as fs from 'fs';
import * as PATH from 'path';
import { MutationListener } from '../controller/interfaces';
import { revealText } from '../util/language';
import { useState } from './extLibFileProvider';
type Constructor<T> = new (label: string, collapsibleState: vscode.TreeItemCollapsibleState, fullPath: string, localFile?: boolean, enabled?: boolean, used?: useState) => T;
export class FileProvider<T extends vscode.TreeItem> implements vscode.TreeDataProvider<T>, MutationListener {
  private _onDidChangeTreeData: vscode.EventEmitter<T | undefined | null | void> = new vscode.EventEmitter<T | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<T | undefined | null | void> = this._onDidChangeTreeData.event;
  readonly parentDirectory: string | undefined;
  protected files:T[] = [];

  constructor(protected itemType: Constructor<T>, private root: string | undefined) {
    this.parentDirectory = root;
  }

  static getNewInstance(root: string|undefined) {
    return new FileProvider<File>(File, root);
  }
   

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
  
 

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: T): Promise<T[]> {
    if (!this.root) {
      return Promise.resolve([]);
    }
    if (element) {
        return Promise.resolve([]);
    }
    await this.getFiles(this.root);
    vscode.commands.executeCommand('setContext', 'maqueen.extLibFilesLoaded', 'true');
    return this.files;
  }

  /**
   * Gibt die Dateien (ohne Verzeichnisse) des durch path gegebenen Verzeichnisses zurück
   */
  protected async getFiles(dir: string): Promise<void> {
    try {
        const p = vscode.Uri.file(dir);
        const allEntries = await vscode.workspace.fs.readDirectory(p);
        this.files =  allEntries.filter(([_, fileType]) => fileType === vscode.FileType.File) // Nur Dateien
            .map(([name]) => new this.itemType(name, vscode.TreeItemCollapsibleState.None, PATH.join(dir, name)));
    } catch(err){
        this.files = [];
    }
  }

  private pathExists(p: string): boolean {
    try {
      fs.accessSync(p);
    } catch (err) {
      return false;
    }
    return true;
  }
}

export class File extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly path: string,
  ) {
    super(label, collapsibleState);
    this.command = {
        command: "maqueen.openFile",
        title: revealText("Open file","Öffne Datei"),
        arguments: [vscode.Uri.file(path)]
    };
    this.iconPath = label.match(/\.py$/) ? vscode.Uri.file(PATH.join(__filename, '..', '..', '..', 'resources', 'python.svg')) : new vscode.ThemeIcon('file');
  }
}
