import * as vscode from 'vscode';
import { ActionHolder, MutationListener } from "../controller/interfaces";
import { FileProvider } from "./fileProvider";
import { l10n } from 'vscode';
import * as PATH from 'path';
import { CustomError, error2user, errorType, Exception, getErrorMessage } from '../exception';
import * as crypto from 'crypto';
import * as https from 'https';
import { Writable } from 'stream';
import { HashedFiles, libFileTyp } from '../types';
import { calcHash } from '../controller/workspaceController';

export class ExtLibFileProvider extends FileProvider<ExtLibFile> implements vscode.TreeDataProvider<ExtLibFile>, MutationListener, ActionHolder {
    private hashedFiles: HashedFiles[] = [];
    private jsonToFiles = false;
    private retrieve = true;
    private lock = false;
    constructor(private extRoot: string | undefined, private workspaceRoot: string | undefined) {
        super(ExtLibFile, extRoot ? PATH.join(extRoot, 'Libraries', 'extern') : undefined);
    }

    private createActionFrame(action: Function) {
        const actionFrame = async (p: any | void) => {
            try {
                if (this.lock) {
                    return;
                }
                this.lock = true;
                await action(p);
            } catch (err: any) {
                await error2user(err);
            } finally {
                this.lock = false;
            }
        };
        return actionFrame;
    }
    public getAction(actionId: string) {
        switch (actionId) {
            case 'enableLib':
                return this.createActionFrame(
                    async (item: any) => {
                        //item.update({ enabled: true });
                        await this.changeFileState(item, true, item.used);
                        this.refresh();
                    });
            case 'disableLib':
                return this.createActionFrame(
                    async (item: any) => {
                        await this.changeFileState(item, false, item.used);
                        this.refresh();
                    });
            case 'loadExtLibFile':
                return this.createActionFrame(
                    async (item: any) => {
                        if (this.parentDirectory) {
                            const name = await this.getFileFromGitHub(this.parentDirectory);
                            if (name && this.workspaceRoot) {
                                await this.copyToWorkspace(this.parentDirectory, name, true);
                            }
                            this.refresh();
                        }
                    });
            case 'addExtLibFile':
                return this.createActionFrame(
                    async (item: any) => {
                        if (this.parentDirectory) {
                            const name = await this.selectAndCopyFile(this.parentDirectory);
                            if (name && this.workspaceRoot) {
                                await this.copyToWorkspace(this.parentDirectory, name, true);
                            }
                            this.refresh();
                        }
                    });
            case 'deleteExtLib':
                return this.createActionFrame(
                    async (item: any) => {
                        this.parentDirectory && await this.deleteFormExtension(this.parentDirectory, item.label) && this.refresh();
                    });
            case 'removeExtLib':
                return this.createActionFrame(
                    async (item: any) => {
                        this.workspaceRoot && await this.deleteFromWorkspace(this.workspaceRoot, item.label) && this.refresh();
                    });
            case 'copyExtLibFileToWorkspace':
                return this.createActionFrame(
                    async (item: any) => {
                        this.parentDirectory && await this.copyToWorkspace(this.parentDirectory, item.label, false) && this.refresh();
                    });
            case 'refreshExtLibFileToWorkspace':
                return this.createActionFrame(
                    async (item: any) => {
                        this.parentDirectory && await this.copyToWorkspace(this.parentDirectory, item.label, true) && this.refresh();
                    });

        }
        throw new Exception('getAction does not recognise a command for passed actionId', 500);
    }

    refresh(): void {
        this.retrieve = true;
        super.refresh();
    }

    protected async getFiles(dir: string): Promise<void> {
        try{
            if (!this.jsonToFiles) {
                this.hashedFiles = await readJsonFile(dir);
                this.hashedFiles.sort(fileSort);
                this.jsonToFiles = true;
            }
            //await selectAndCopyFile(dir);
            //await getFileFromGitHub(dir);
            if (!this.retrieve) {
                return;
            }
            const p = vscode.Uri.file(dir);
            const localFiles = (await this.retrieveFiles(PATH.join(dir, 'local'))).map(([name]) => new ExtLibFile(name, vscode.TreeItemCollapsibleState.None, PATH.join(dir, 'local', name), true, true, useState.used));
            const gitHubFiles = (await this.retrieveFiles(PATH.join(dir, 'gitHub'))).map(([name]) => new ExtLibFile(name, vscode.TreeItemCollapsibleState.None, PATH.join(dir, 'gitHub', name), false, true, useState.used));

            this.files = [...localFiles, ...gitHubFiles];
            this.files.sort(fileSort);
            //let extLibFiles = await readJsonFile(dir);
    
            await this.checkConsistence(this.files, this.hashedFiles);
            let workspaceFiles: ExtLibFile[] = [];
            if(this.workspaceRoot){
                const wr:string = this.workspaceRoot;
                workspaceFiles=(await this.retrieveFiles(wr)).filter(([name])=>this.getCollisionIndex(name)===-1&&name.match(/\.py$/)).map(([name]) => new ExtLibFile(name, vscode.TreeItemCollapsibleState.None, PATH.join(wr, name), true, true, useState.stillUsed));
            }
            this.files = [...this.files, ...workspaceFiles];
            this.files.sort(fileSort);
            this.retrieve = false;
        } catch(err){}
        finally{
        }  
    }

    //Gibt einen Array mit allen Dateien im Verzeichnis /dir zurück
    private async retrieveFiles(dir: string) {
        const p = vscode.Uri.file(dir);
        try {
            await vscode.workspace.fs.stat(p);
        } catch(err){
            await vscode.workspace.fs.createDirectory(p);
        }
        try {
            const allEntries = (await vscode.workspace.fs.readDirectory(p));
            return allEntries.filter(([_, fileType]) => fileType === vscode.FileType.File); // Nur Dateien
        } catch (err: any) {
            throw new Exception(`The files from the directory ${dir} could not be read.${err.message}`, 501);
            //return [];
        }
    }

    public async updateGitHubFiles() {
        if (this.parentDirectory && !this.jsonToFiles) {
            this.hashedFiles = await readJsonFile(this.parentDirectory);
            this.hashedFiles.sort(fileSort);
            this.jsonToFiles = true;
        }
        const gitHubFiles = this.hashedFiles.filter(f => f.type === libFileTyp.gitHub);
        for (let i = 0; i < gitHubFiles.length; i++) {
            const file = gitHubFiles[i];
            const data = await fetchFileFromGitHubIfModified(file.props.url, file.props.date);
            if (data.content) {
                if (!this.parentDirectory) {
                    throw new Exception('extLibFileProvider: no parentDirectory', 505);
                }
                await this.installFile(this.parentDirectory, file.props.url, data.content, libFileTyp.gitHub);
            }
        }
    }

    async installFile(dir: string, path: string, newFileData: Uint8Array, type: libFileTyp) {
        const name = PATH.basename(path);
        const targetPath = PATH.join(dir, type === libFileTyp.local ? 'local' : 'gitHub', PATH.basename(path));
        //const jsonFiles = await readJsonFile(dir);
        const index = this.getCollisionIndex(name);
        let deleteUri: vscode.Uri | undefined = undefined;
        let refresh = false;
        if (index > -1) {
            const hashedFile = this.hashedFiles[index];
            const root = this.extRoot;
            if(root){
                deleteUri = type !== hashedFile.type ? vscode.Uri.file(PATH.join(root, 'Libraries', 'extern', hashedFile.type === libFileTyp.local?'local': 'gitHub', hashedFile.label)) : undefined;
            }
            
            hashedFile.enabled = hashedFile.enabled;
            hashedFile.hash = calcHash(newFileData);
            hashedFile.type = type;
            hashedFile.props.date = (new Date().toUTCString());
            hashedFile.props.url = type === libFileTyp.gitHub ? path : "";
            refresh = true;
        } else {
            this.hashedFiles.push({ label: PATH.basename(path), hash: calcHash(newFileData), type: type === libFileTyp.local ? libFileTyp.local : libFileTyp.gitHub, enabled: true, props: { date: (new Date().toUTCString()), url: type === libFileTyp.gitHub ? path : '' } });
        }
        if(deleteUri){
            await vscode.workspace.fs.delete(deleteUri);
        }
        await vscode.workspace.fs.writeFile(vscode.Uri.file(targetPath), newFileData);
        await writeJsonFile(dir, this.hashedFiles);
        if(refresh){
            this.refresh();
        }
    }
    async writeLocalLibFile(dir: string, path: string) {
        const targetPath = PATH.join(dir, 'local', PATH.basename(path));


        const fileData = await vscode.workspace.fs.readFile(vscode.Uri.file(path));
        await this.installFile(dir, path, fileData, libFileTyp.local);
    }
    async writeExtLibFile(dir: string, path: string, type: libFileTyp) {
        if (type === libFileTyp.gitHub) {
            if(path.match(/^https:\/\/github\.com\/[a-zA-Z]+\/[a-zA-Z]+\/blob(\/[a-zA-Z0-9_]+)+\/[a-zA-Z0-9_-]+\.py$/)){
                path = path.replace(/blob\//, 'refs/heads/').replace(/github\.com/, 'raw.githubusercontent.com');
            }
            if (!path.match(/^https:\/\/raw\.githubusercontent\.com\/[a-zA-Z0-9]+\/[a-zA-Z0-9]+\/refs\/heads(\/[a-zA-Z0-9_]+)+\/[a-zA-Z0-9_-]+\.py$/)&&!path.match(/^https:\/\/github.com\/lernbaum\/microbit\/raw\/main\/[a-zA-Z0-9_-]+\.py/)) {
                throw new CustomError(l10n.t({ message: 'The URL {0} is not in the correct format.', args: [path], comment: '{0} ist eine URL zu einem File auf GitHub.' }),errorType.gitHubFile,506);
            }
        }
        const name = PATH.basename(path);
        if (this.extRoot && (!(await checkLibFileName(this.extRoot, name)))) {
            return false;
        }
        if (this.getCollisionIndex(name) > -1) {
            const message = vscode.l10n.t({ message: 'A module named {0} already exists. Do you want to replace it?', args: [PATH.basename(path)], comment: ['{0} ist ein Pythonmodul'] });
            const yes = l10n.t('Yes');
            const userResponse = await vscode.window.showInformationMessage(
                message,
                { modal: true }, // modal makes the prompt blocking
                yes,
            );
            if (userResponse !== yes) {
                return false;
            }
        }
        if (type === libFileTyp.local) {
            try {
                await this.writeLocalLibFile(dir, path);
                return true;
            } catch (err) {
                vscode.window.showErrorMessage(l10n.t({ message: 'The module {0} could not be installed.', args: [PATH.basename(path)], comment: '{0} ist eine URL zu einem File auf GitHub.' }));
            }
        } else {
            const data = await fetchFileFromGitHub(path);
            await this.installFile(dir, path, data, libFileTyp.gitHub);
            return true;
        }
    }

    private getCollisionIndex(name: string) {
        let collisionIndex = -1;
        for (let i = 0; i < this.hashedFiles.length; i++) {
            if (this.hashedFiles[i].label === name) {
                collisionIndex = i;
            }
        }
        return collisionIndex;
    }
    async selectAndCopyFile(dir: string) {
        const fileUri = await vscode.window.showOpenDialog({
            canSelectMany: false, // Erlaubt die Auswahl mehrerer Dateien
            openLabel: 'Select files',
            filters: {
                'Python files': ['py'] // Filtert nur .py Dateien
            }
        });

        if (fileUri && fileUri[0]) {
            await this.writeExtLibFile(dir, fileUri[0].fsPath, libFileTyp.local);
            return PATH.basename(fileUri[0].fsPath);
        }
        return "";
    }

    async getFileFromGitHub(dir: string) {
        let gitUrl = await vscode.window.showInputBox({
            prompt: l10n.t("The URL of the file on GitHub"),
            placeHolder: l10n.t("https://raw.githubusercontent.com/..."),
        });
        if (!gitUrl) {
            vscode.window.showErrorMessage(l10n.t('URL is required.'));
            return false;
        }
        await this.writeExtLibFile(dir, gitUrl, libFileTyp.gitHub);
        return PATH.basename(gitUrl);
        //downloadFileFromGitHub(dir, gitUrl);
    }

    /**
     * Überprüft, ob die im Json-File gelisteten Files mit denjenigen aus /libraries/extern gelesenen übereinstimmen und updatet auch die ExtLibFiles (TreeItems) mit enabled und used
     * @param f1 aus den Dateinen gelesen
     * @param f2 aus dem Json-File
     * @returns true, wenn identisch, wirf ansonsten eine Exception.
     */
    async checkConsistence(f1: ExtLibFile[], f2: HashedFiles[]) {
        if (f1.length === f2.length) {
            let con = true;
            for (let i = 0; i < f1.length; i++) {
                if (f1[i].label !== f2[i].label) {
                    con = false;
                    break;
                }
                let used = useState.unused;
                if (this.workspaceRoot) {
                    try {
                        const data = await vscode.workspace.fs.readFile(vscode.Uri.file(PATH.join(this.workspaceRoot, f2[i].label)));

                        const h = calcHash(data);
                        const d = data.toString();
                        used =calcHash(data) === f2[i].hash ? useState.used : useState.olderUsed;
                    } catch (err) {
                        //Datei existiert nicht.
                    }
                }
                f1[i].update(f2[i].enabled, used);
            }
            if (con) {
                return true;
            }
        }
        throw new Exception('The consistency check between the external library files and their representation in a JSON file failed.', 209);
    }
    async changeFileState(file: ExtLibFile, enabled: boolean, used: useState) {
        let dir: string;
        if (this.parentDirectory) {
            file.update(enabled, used);
            for (let i = 0; i < this.hashedFiles.length; i++) {
                const f = this.hashedFiles[i];
                if (f.label === file.label) {
                    f.enabled = enabled;
                }
            }
            await writeJsonFile(this.parentDirectory, this.hashedFiles);
        }
    }
    async copyToWorkspace(dir: string, label: string, deleteFirst: boolean) {
        const hashedFile = this.hashedFiles.filter(f => f.label === label);
        if (this.workspaceRoot) {
            try {
                const source = PATH.join(dir, hashedFile[0].type === libFileTyp.local ? 'local':'gitHub', hashedFile[0].label);
                const target = PATH.join(this.workspaceRoot, label);
                await vscode.workspace.fs.copy(vscode.Uri.file(PATH.join(dir, hashedFile[0].type === libFileTyp.local ? 'local':'gitHub', hashedFile[0].label)), vscode.Uri.file(PATH.join(this.workspaceRoot, label)),{overwrite: deleteFirst}); 
                return true;
            } catch (err: any) {
                throw new Exception(getErrorMessage(err), 502);
            }
        }
    }
    async deleteFromWorkspace(dir: string, label: string) {
        if (this.workspaceRoot) {
            const fileUri = vscode.Uri.file(PATH.join(this.workspaceRoot, label));
            try {
                await vscode.workspace.fs.stat(fileUri);
            } catch (err) {
                vscode.window.showWarningMessage(l10n.t({ message: 'File {0} did not exist', args: [label], comment: ['{0} ist ein externes Modul im Workspace.'] }));
                return false;
            }
            try {
                await vscode.workspace.fs.delete(fileUri);
                return true;
            } catch (err) {
                throw new Exception(getErrorMessage(err), 503);
            }
        }
    }
    async deleteFormExtension(dir: string, label: string) {
        const message = l10n.t({ message: 'Do you really want to remove the {0} module from the extension?', args: [label], comment: ['{0} ist ein ExtLibFile'] });
        const yes = l10n.t('Yes');
        const userResponse = await vscode.window.showInformationMessage(
            message,
            { modal: true }, // modal makes the prompt blocking
            yes,
        );
        if (userResponse !== yes) {
            return false;
        }
        const hashedFiles = this.hashedFiles.filter(f => f.label !== label);
        const fileToRemove = this.hashedFiles.filter(f => f.label === label);
        if (fileToRemove[0]) {
            const file = fileToRemove[0];
            try {
                await vscode.workspace.fs.delete(vscode.Uri.file(PATH.join(dir, file.type === libFileTyp.local ? 'local' : 'gitHub', file.label)));
                this.hashedFiles = hashedFiles;
                await writeJsonFile(dir, hashedFiles);
                return true;
            } catch (err) {
                throw new Exception(getErrorMessage(err), 504);
            }
        }
    }
}

class ExtLibFile extends vscode.TreeItem {
    private icons: vscode.ThemeIcon[] = [];
    private disabledIcons: vscode.ThemeIcon[] = [];
    //states: enabledUsed, enabledNotUsed, disabledUsed, disabledNotUsed
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly origPath: string,
        public readonly localFile: boolean | undefined,
        private enabled: boolean | undefined,
        private used: useState | undefined,
    ) {
        super(label, collapsibleState);
        const rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
		? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
        if(this.used !== useState.unused&&rootPath){
            this.command = {
                command: "maqueen.openFile",
                title: l10n.t("Open file"),
                arguments: [vscode.Uri.file(PATH.join(rootPath,this.label))]
            };
        }
        this.icons = ['charts.green', 'charts.orange', 'charts.red', 'inputOption.foreground'].map(c => new vscode.ThemeIcon(!localFile ? 'github' : 'file', new vscode.ThemeColor(c)));
        this.disabledIcons = ['charts.green', 'charts.orange', 'charts.red', 'inputOption.disabledForeground'].map(c => new vscode.ThemeIcon('eye-closed', new vscode.ThemeColor(c)));
        // this.iconPath = this.icons[state ? state : 0];
        // this.contextValue = localFile ? 'enabled' : 'disabled';
        this.setContext(enabled, used);
    }
    get path(): string {
        const rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
		? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
        if(this.used !== useState.unused&&rootPath){
            return PATH.join(rootPath,this.label);
        } else{
            return this.origPath;
        }
    }
    update(enabled: boolean, used: useState) {
        this.enabled = enabled;
        this.used = used;
        if(used===useState.unused){
            this.command = undefined;
        }
        this.setContext(enabled, used);
    }
    setContext(enabled: boolean | undefined, used: useState | undefined) {
        const en = enabled === true;
        const us = used === useState.used || used === useState.olderUsed || used === useState.stillUsed;
        const index = us ? used === useState.used ? 0 : used === useState.olderUsed ? 1 : 2 : 3;
        this.iconPath = en ? this.icons[index] : this.disabledIcons[index];
        this.contextValue = `${enabled ? 'enabled' : 'disabled'}${us ? used === useState.used ? 'Used' : used === useState.olderUsed? 'OldUsed' : 'StillUsed' : 'NotUsed'}`;
    }
}

const fileSort = (a: any, b: any) => {
    if (a.label > b.label) {
        return 1;
    } else if (a.label < b.label) {
        return -1;
    }
    return 0;
};

export enum useState {
    used,
    olderUsed,
    unused,
    stillUsed
}

async function readJsonFile(dir: string): Promise<HashedFiles[]> {
    try {
        return JSON.parse((await vscode.workspace.fs.readFile(vscode.Uri.file(PATH.join(dir, 'extLibFiles.json')))).toString());

    } catch (err: any) {
        throw new Exception(getErrorMessage(err), 208);
    }
}
async function checkLibFileName(dir: string, name: string) {
    try {
        const intLibFiles = JSON.parse((await vscode.workspace.fs.readFile(vscode.Uri.file(PATH.join(dir, 'hash.json')))).toString());
        for (let i = 0; i < intLibFiles.length; i++) {
            if (intLibFiles[i].name === name) {
                throw new CustomError(l10n.t({ message: 'The name {0} is already reserved for an internal module.', args: [name], comment: ['{0} ist der Name einer externen Bibliothek.'] }), errorType.extLibNameCol, 507);
            }
        }
        return true;
    } catch (err: any) {
        throw new Exception(getErrorMessage(err), 208);
    }
}
async function writeJsonFile(dir: string, files: HashedFiles[]) {
    try {
        await vscode.workspace.fs.writeFile(vscode.Uri.file(PATH.join(dir, 'extLibFiles.json')), (new TextEncoder()).encode(JSON.stringify(files.sort(fileSort), null, 4)));

    } catch (err: any) {
        throw new Exception(getErrorMessage(err), 210);
    }
}

function fetchFileFromGitHub(url: string): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        let chunks: Uint8Array[] = [];

        // HTTP GET-Anfrage
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(`Failed to get file from URL: ${url} (Status Code: ${response.statusCode})`);
                return;
            }

            // Erstelle einen Writable-Stream, um die Antwortdaten in 'chunks' zu speichern
            const writableStream = new Writable({
                write(chunk, encoding, callback) {
                    chunks.push(new Uint8Array(chunk)); // Konvertiere jeden Chunk in Uint8Array
                    callback();
                }
            });

            // Leite die Antwort durch den Writable-Stream
            response.pipe(writableStream);

            // Sobald der Stream beendet ist, kombiniere die Chunks und gebe sie als Uint8Array zurück
            response.on('end', () => {
                const fullArray = Buffer.concat(chunks.map(chunk => Buffer.from(chunk))); // Konvertiere die Chunks in einen Buffer
                resolve(new Uint8Array(fullArray)); // Konvertiere Buffer in Uint8Array
            });
        }).on('error', (error) => {
            reject(`Error fetching file: ${error.message}`);
        });
    });

}
function fetchFileFromGitHubIfModified(url: string, lastModified: string | null): Promise<{ content: Uint8Array | null, modified: boolean }> {
    return new Promise((resolve, reject) => {
        let chunks: Uint8Array[] = [];

        const options = {
            headers: lastModified ? { 'If-Modified-Since': lastModified } : {}
        };

        // HTTP GET-Anfrage
        https.get(url, options, (response) => {
            if (response.statusCode === 304) {
                // Datei wurde nicht geändert
                resolve({ content: null, modified: false });
                return;
            }

            if (response.statusCode !== 200) {
                reject(`Failed to get file from URL: ${url} (Status Code: ${response.statusCode})`);
                return;
            }

            const lastModifiedHeader = response.headers['last-modified'];

            // Erstelle einen Writable-Stream, um die Antwortdaten in 'chunks' zu speichern
            const writableStream = new Writable({
                write(chunk, encoding, callback) {
                    chunks.push(new Uint8Array(chunk)); // Konvertiere jeden Chunk in Uint8Array
                    callback();
                }
            });

            // Leite die Antwort durch den Writable-Stream
            response.pipe(writableStream);

            // Sobald der Stream beendet ist, kombiniere die Chunks und gebe sie als Uint8Array zurück
            response.on('end', () => {
                const fullArray = Buffer.concat(chunks.map(chunk => Buffer.from(chunk))); // Konvertiere die Chunks in einen Buffer
                resolve({
                    content: new Uint8Array(fullArray), // Konvertiere Buffer in Uint8Array
                    modified: true,
                });
            });
        }).on('error', (error) => {
            reject(`Error fetching file: ${error.message}`);
        });
    });
}
