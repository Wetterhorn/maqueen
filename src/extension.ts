// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { FileProvider } from './treeDataProvider/fileProvider';
import { registerFileCommands } from './commands/fileRelatedCommands';
import { registerWorkspaceCommands } from './commands/workspaceRelatedCommands';
import { registerMicrobitCommands } from './commands/microbitRelatedCommands';
import { WorkspaceController } from './controller/workspaceController';
import { WelcomeDummyProvider } from './treeDataProvider/welcomeDummyProvider';
import { ControlProvider } from './treeDataProvider/controlProvider';
import { MicrobitController } from './controller/microbitController';
import { ExtLibFileProvider } from './treeDataProvider/extLibFileProvider';
import { registerExtLibFileCommands } from './commands/extLibFilesRelatedCommands';
import { l10n } from 'vscode';
import { ErrorLogger } from './util/logErrors';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	vscode.commands.executeCommand('setContext', 'maqueen.fileUploadRunning', false);
	vscode.commands.executeCommand('setContext', 'maqueen.extensionActivated', false);
	ErrorLogger.getInstance().init(context);
	vscode.window.registerTreeDataProvider('welcome', new WelcomeDummyProvider());
	const rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
		? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
	const workspaceController = new WorkspaceController(context);
	workspaceController.hashExtLibFiles();
	const microbitController = new MicrobitController(context);
	const mainFileProvider = FileProvider.getNewInstance(rootPath ? path.join(rootPath, "src", "main") : undefined);
	vscode.window.registerTreeDataProvider('mainFileExplorer', mainFileProvider);
	workspaceController.addMutationListener(mainFileProvider, true, true, false);
	const modFileProvider = FileProvider.getNewInstance(rootPath ? path.join(rootPath, "src") : undefined);
	vscode.window.registerTreeDataProvider('modFileExplorer', modFileProvider);
	workspaceController.addMutationListener(modFileProvider, true, true, false);
	const controlProvider = new ControlProvider();
	vscode.window.registerTreeDataProvider('control', controlProvider);
	const extLibFileProvider = new ExtLibFileProvider(context.extensionPath, rootPath);
	vscode.window.registerTreeDataProvider('extLibFileExplorer', extLibFileProvider);
	workspaceController.addExtLibMutationListener(extLibFileProvider);
	microbitController.addMutationListener(controlProvider);
	// Dateisystemänderungen überwachen
	const watcher = vscode.workspace.createFileSystemWatcher('**/*');
	context.subscriptions.push(watcher);
	const refreshWorkspace = (uri: vscode.Uri, mutation: string): void => {
		void workspaceController.refresh(uri, mutation).catch(error => console.error(error));
	};

	// Wenn eine Datei erstellt wird, den TreeView aktualisieren
	context.subscriptions.push(watcher.onDidCreate(uri => refreshWorkspace(uri, 'create')));

	context.subscriptions.push(watcher.onDidChange(uri => refreshWorkspace(uri, 'change')));

	// Wenn eine Datei gelöscht wird, den TreeView aktualisieren
	context.subscriptions.push(watcher.onDidDelete(uri => refreshWorkspace(uri, 'delete')));
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
	const instructionsUri = workspaceRoot
		? vscode.Uri.joinPath(workspaceRoot, '.github', 'copilot-instructions.md').toString() : undefined;
	const refreshInstructions = (document: vscode.TextDocument): void => {
		if (document.uri.toString() === instructionsUri) refreshWorkspace(document.uri, 'change');
	};
	// Include unsaved edits and undo/close, not just filesystem save events.
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(event => refreshInstructions(event.document)),
		vscode.workspace.onDidSaveTextDocument(refreshInstructions),
		vscode.workspace.onDidCloseTextDocument(refreshInstructions)
	);

	vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor) {
			const fileUri = editor.document.uri;
			const dirname = path.dirname(fileUri.fsPath);
			let showSendButton = false;
			if(rootPath){
				showSendButton = dirname === path.join(rootPath, 'src', 'main') || dirname === path.join(rootPath, 'src');
			}
			vscode.commands.executeCommand('setContext', 'maqueen.showSendButton', showSendButton);
		}
	});

	// Beim Start den aktuellen Wert der Einstellung überprüfen
	updateViewVisibility();

	// Überwachen, ob sich die Konfiguration ändert
	vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('maqueen.showModView')) {
			updateViewVisibility();
		}
		if (event.affectsConfiguration('maqueen.advancedControl')) {
			controlProvider.refresh();
		}
	});


	function updateViewVisibility() {
		// Hole die aktuelle Einstellung
		const config = vscode.workspace.getConfiguration();
		const showModView = config.get<boolean>('maqueen.showModView', false);

		// Setze den Kontext für die Sichtbarkeit der View
		vscode.commands.executeCommand('setContext', 'maqueen.showModView', showModView);
		//modFileProvider.refresh();
	}

	registerFileCommands({ context: context });
	registerWorkspaceCommands({ context: context, controller: workspaceController });
	registerMicrobitCommands({ context: context, controller: microbitController });
	registerExtLibFileCommands({ context: context, controller: extLibFileProvider });
	await workspaceController.initialize();
	await extLibFileProvider.updateGitHubFiles();
	console.log("Extension is active");
	vscode.commands.executeCommand('setContext', 'maqueen.extensionActivated', true);
}

// This method is called when your extension is deactivated
export function deactivate() { 
	console.log("Extension is deactivated");
	vscode.commands.executeCommand('setContext', 'maqueen.extensionActivated', false);
}
