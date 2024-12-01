import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { Exception, getErrorMessage } from '../exception';
import { ActionHolder, MutationListener } from './interfaces';
import { l10n } from 'vscode';
import { HashedFiles, libFileTyp } from '../types';

export class WorkspaceController implements ActionHolder {
    private context: vscode.ExtensionContext;
    private missingFiles: File[] = [];
    private mutationListener: { listener: MutationListener, create: boolean, del: boolean, change: boolean }[] = [];
    private extLibMutationListener: MutationListener[] = [];

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        const rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
            ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
        vscode.commands.executeCommand('setContext', 'maqueen.workspaceIsOk', 'false');
        if (rootPath) {
            (async () => {
                let ok = false;
                await this.hashDefaultLibFiles();
                const lib = await this.areLibFilesIntact();
                const sourceFi = await this.checkSourceFiles(false);
                if (await this.areLibFilesIntact() && await this.checkSourceFiles(false)) {
                    ok = true;
                }
                vscode.commands.executeCommand('setContext', 'maqueen.workspaceIsOk', ok ? 'true' : 'false');
            })();
        }
    }

    public async refresh(uri: vscode.Uri, mutation: string) {
        const childPath = uri.fsPath;
        const root = this.getRootPath();
        if (mutation === 'delete' || mutation === 'change' || mutation === 'create') {
            if (!(childPath.startsWith(path.join(root, 'src', 'main') + path.sep))) {
                if (!(await this.areLibFilesIntact() && await this.checkSourceFiles(false))) {
                    vscode.commands.executeCommand('setContext', 'maqueen.workspaceIsOk', 'false');
                } else {
                    vscode.commands.executeCommand('setContext', 'maqueen.workspaceIsOk', 'true');
                }
            }
        }
        if ((mutation === 'change' || mutation === 'create')&& !childPath.startsWith(path.join(root, 'src') + path.sep)) {
            this.refreshExtLibFileListener();
        }
        this.mutationListener.forEach(l => {
            const parentPath = l.listener.parentDirectory;
            if (parentPath && childPath.startsWith(parentPath + path.sep)) {
                switch (mutation) {
                    case 'create':
                        if (l.create) {
                            l.listener.refresh();
                        }
                        break;
                    case 'delete':
                        if (l.del) {
                            l.listener.refresh();
                        }
                        break;
                    case 'change':
                        if (l.del) {
                            l.listener.refresh();
                        }
                        break;
                }
            }
        });
    }


    public addMutationListener(listener: MutationListener, create: boolean, del: boolean, change: boolean, events?: string[]) {
        this.mutationListener.push({ listener: listener, create: create, del: del, change: change });
    }

    public addExtLibMutationListener(listener: MutationListener) {
        this.extLibMutationListener.push(listener);
    }

    /**
     * Liefert die action 'createProject'
     * @param actionId 
     * @returns 
     */
    public getAction(actionId: string) {
        switch (actionId) {
            case 'createProject':
                return async () => {
                    try {
                        const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.getRootPath()));
                        let result: string | undefined;
                        if (files.length > 0) {
                            const yes = l10n.t("Yes");
                            result = await vscode.window.showInformationMessage(
                                l10n.t('The opened folder is not empty. Do you really want to change the contents of the folder? Files may be lost in the process.'),
                                { modal: true },
                                yes,                       // Option 1
                                //'Nein'                      // Option 2
                            );
                            if (result !== yes) { return; }
                        }
                        const missingFiles = await this.checkLibFiles();
                        if (missingFiles.length > 0) {
                            this.healLibFiles();
                        }
                        await this.checkAndHealExtLibFiles();
                        await this.checkSourceFiles(true);
                        this.refreshExtLibFileListener();
                        vscode.commands.executeCommand('setContext', 'maqueen.workspaceIsOk', 'true');

                    } catch (err: any) {
                        throw err;
                    }
                };
        }
        throw new Exception('getAction does not recognise a command for passed actionId', 207);
    }

    public refreshExtLibFileListener() {
        this.extLibMutationListener.forEach(l => l.refresh());
    }

    /**
     * Überprüft, ob in einem Maqueen-Projekt die notwendigen Bibliotheksdateien vorhanden sind.
     * @returns Array mit fehlenden oder fehlerhaften Dateien
     */
    public async checkLibFiles(): Promise<File[]> {
        const root = this.getRootPath();
        const missingFiles: File[] = [];
        try {
            const content = await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(this.context.extensionPath, 'hash.json')));
            const files: File[] = JSON.parse(content.toString());

            for (const file of files) {
                const filePath = path.join(root, ...file.dirs, file.name);
                try {
                    const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
                    const h = calcHash(data);
                    if (h !== file.hash) {
                        missingFiles.push(file);
                    }
                } catch (err) {
                    missingFiles.push(file);
                }
            }
        } catch (err: any) {
            throw new Exception(getErrorMessage(err), 200);
        }
        this.missingFiles = missingFiles;
        return missingFiles;
    }

    async checkAndHealExtLibFiles() {
        const root = this.getRootPath();
        try {
            // Löschen aller Dateien (ohne Ordner) im Workspace
            // const fileOutsideSrc = (await vscode.workspace.fs.readDirectory(vscode.Uri.file(root))).filter(([_, fileType]) => fileType === vscode.FileType.File);
            // for(let i = 0; i < fileOutsideSrc.length; i++){
            //     const [fileName, fileType] = fileOutsideSrc[i];
            //     vscode.workspace.fs.delete(vscode.Uri.file(path.join(root, fileName)));
            // }
            //const content = fs.readFileSync(path.join(this.context.extensionPath,'Libraries', 'extern', 'extLibFiles.json'), 'utf8');
            const content = await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(this.context.extensionPath, 'Libraries', 'extern', 'extLibFiles.json')));

            const files: HashedFiles[] = JSON.parse(content.toString());

            for (const file of files) {
                try {
                    if (file.enabled) {
                        // Nur kopieren, wenn target noch nicht existiert
                        await vscode.workspace.fs.copy(vscode.Uri.file(this.getPathToExtModFile(file)), vscode.Uri.file(path.join(root, file.label)), { overwrite: false });
                    }
                } catch (err) {
                    //throw new Exception(getErrorMessage(err), 213);
                }
            }
        } catch (err: any) {
            throw new Exception(getErrorMessage(err), 212);
        }
        return true;
    }

    /**
     * Überprüft, ob in einem Maqueen-Projekt die notwendigen Bibliotheksdateien vorhanden sind.
     * @returns true, falls vollständig und intakt
     */
    public async areLibFilesIntact(): Promise<boolean> {
        try {
            const result = await this.checkLibFiles();
            return result.length === 0;
        } catch (err: any) {
            throw new Exception(err.message, 200);
        }
    }

    /**
     * Überprüft die Verzeichnisstruktur 
     * @param heal true, falls Struktur repariert werden soll
     */
    public async checkSourceFiles(heal: boolean): Promise<boolean> {
        return new Promise<boolean>(async (resolve, reject) => {
            const root = this.getRootPath();
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(path.join(root, 'src', 'main')));
            } catch (err: any) {
                if (heal) {
                    try {
                        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(root, 'src', 'main')));
                    } catch (err: any) {
                        reject(new Exception(getErrorMessage(err), 203));
                        return;
                    }
                } else {
                    resolve(false);
                    return;
                }
            }
            try {
                const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(path.join(root, 'src', 'main')));
                for (let i = 0; i < files.length; i++) {
                    if (files[i][0].match(/\.py$/)) {
                        resolve(true);
                        return;
                    }
                }
                if (heal) {
                    try {
                        await this.generateMainFile('main.py');
                        //vscode.workspace.fs.copy(vscode.Uri.file(path.join(this.context.extensionPath, 'main.py')), vscode.Uri.file(path.join(root, 'src', 'main', 'main.py')), { overwrite: false });
                        resolve(true);
                        return;
                    } catch (err: any) {
                        reject(new Exception(getErrorMessage(err), 204));
                        return;
                    }
                } else {
                    resolve(false);
                    return;
                }
            } catch (err: any) {
                reject(new Exception(err.message, 205));
                return;
            }
        });
    }

    /**
     * Heilt die Bibliotheksdateien
     */
    public async healLibFiles() {
        const root = this.getRootPath();
        const extensionPath = this.context.extensionPath;
        try {
            for (const file of this.missingFiles) {
                const sourcePath = path.join(extensionPath, 'Libraries', ...file.extDirs, file.name);
                const targetPath = path.join(root, ...file.dirs, file.name);
                vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(root, ...file.dirs)));
                const r = await vscode.workspace.fs.copy(vscode.Uri.file(sourcePath), vscode.Uri.file(targetPath), { overwrite: true });
            }
        } catch (err: any) {
            throw new Exception(getErrorMessage(err), 201);
        }
    }
    /**
     * Berechnet die Hashwerte der Bibliotheksdateien und legt diese zusammen mit den Dateinamen und der Verzeichnishirarchie ein einer json-Datei ab.
     * 
     */
    public async hashDefaultLibFiles() {
        const extensionPath = this.context.extensionPath;
        try{
            vscode.workspace.fs.stat(vscode.Uri.file(path.join(extensionPath, 'hash.json')));
        } catch (err){
            return;
        }
        const files: File[] = [];
        await findPythonFiles(path.join(extensionPath, 'Libraries', 'Microbit-Basic-Stubs-main'), ['Microbit-Basic-Stubs-main'], files, []);
        await findPythonFiles(path.join(extensionPath, 'Libraries', 'Microbit-Extended-Stubs-main'), ['Microbit-Extended-Stubs-main'], files, []);
        //findPythonFiles(path.join(extensionPath, 'Libraries', 'Maqueen'), ['Maqueen'], files, []);
        await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(extensionPath, 'hash.json')), new Uint8Array(Buffer.from(JSON.stringify(files, null, 4))));
    }

    public async hashExtLibFiles() {
        const extensionPath = this.context.extensionPath;
        const files: File[] = [];
        findPythonFiles(path.join(extensionPath, 'Libraries', 'extern'), ['extern'], files, []);
        await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(extensionPath, 'extHash.json')), new Uint8Array(Buffer.from(JSON.stringify(files, null, 4))));
    }

    private getRootPath() {
        const rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
            ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
        if (rootPath) {
            return rootPath;
        }
        throw new Exception('There is no rootPath because presumably no workspace is open.', 202);
    }

    private getPathToExtModFile(file: HashedFiles) {
        const root = this.context.extensionPath;
        return path.join(root, 'Libraries', 'extern', file.type === libFileTyp.local?'local': 'gitHub', file.label);
    }

    private async generateMainFile(name: string) {
        const root = this.getRootPath();
        try {
            const files = (await vscode.workspace.fs.readDirectory(vscode.Uri.file(root))).filter(f => {
                const [name, type] = f;
                return type===vscode.FileType.File&&name.match(/^[a-zA-Z_\-0-9]+.py/);
            });
            let content = '';
            for (let i = 0; i < files.length; i++) {
                const [name, type] = files[i];
                content += `from ${name.replace(/\.py/, '')} import *\n`;
            }
            if(content !== ''){
                content += '\n';
            }
            content += '# Your code follows here.';
            await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(root, 'src', 'main', name)), new Uint8Array(Buffer.from(content)));

        } catch (err: any) {

        }
    }

}


type File = {
    name: string;
    dirs: string[];
    extDirs: string[];
    hash: string;
};

/**
 * 
 * @param dir Hauptverzeichnis, indem Python-Files gesucht werden
 * @param extDirs Array der Verzeichnisse (inkl. Hauptverzeichnis) in hirarchischer Reihenfolge zu Verzeichnis, indem sich die gefundene Datei befindet
 * @param fileList Liste der gefundenen Files
 * @param directories Verzeichnisse entlang des Suchpfades zur Datei unterhalb Hauptverzeichnis
 * @returns 
 */
async function findPythonFiles(dir: string, extDirs: string[], fileList: File[] = [], directories: string[] = []) {
    const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));

    for(let i = 0; i < files.length; i++) {
        const [file, type] = files[i];
        const filePath = path.join(dir, file);
        const fileStat = fs.statSync(filePath);

        if (fileStat.isDirectory()) {
            const dirs = [...directories];
            dirs.push(file);
            await findPythonFiles(filePath, extDirs, fileList, dirs); // Rekursiver Aufruf für Unterverzeichnisse
        } else if (file.endsWith('.py')) {
            const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
            const f = {
                name: file,
                dirs: directories,
                extDirs: [...extDirs, ...directories],
                hash: calcHash(data),
            };
            fileList.push(f);
        }
    }

    return fileList;

}

export function calcHash(data:Uint8Array){
    return crypto.createHash('sha256').update(data).digest('hex');
}