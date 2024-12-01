import * as vscode from 'vscode';

export class WelcomeDummyProvider implements vscode.TreeDataProvider<vscode.TreeItem> {

  constructor() {}
   

 

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    return [];
  }
}
