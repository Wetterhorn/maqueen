    import { createHash } from 'crypto';
import * as vscode from 'vscode';
import { fetchFileFromGitHubIfModified } from './fetchFromGitHub';

export const COPILOT_INSTRUCTIONS_URL =
    'https://raw.githubusercontent.com/lernbaum/microbit/main/copilot-instructions.md';

interface CopilotCache {
    hash: string;
    url: string | null;
    etag: string | null;
    lastModified: string | null;
}

export interface CopilotSyncResult {
    updated: boolean;
    hash: string;
    fileUri: vscode.Uri;
}

// The reference file is shared by all workspaces using this extension root.
const queues = new Map<string, Promise<void>>();
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const hasInstructions = (bytes: Uint8Array): boolean => Buffer.from(bytes).toString('utf8').trim().length > 0;
const dirtyDocument = (uri: vscode.Uri): vscode.TextDocument | undefined =>
    vscode.workspace.textDocuments?.find(document => document.uri.toString() === uri.toString() && document.isDirty);
class LocalInstructionsChanged extends Error {}

async function readIfPresent(uri: vscode.Uri): Promise<Uint8Array | null> {
    try { return await vscode.workspace.fs.readFile(uri); }
    catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'FileNotFound') return null;
        throw error; // Permission and other filesystem errors must remain visible.
    }
}

function parseCache(bytes: Uint8Array | null): CopilotCache | null {
    if (bytes === null) return null;
    try {
        const value: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
        if (!value || typeof value !== 'object' || !('hash' in value)
            || typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/i.test(value.hash)) return null;
        const data = value as Record<string, unknown>;
        const header = (value: unknown): string | null =>
            typeof value === 'string' && value.length > 0 && !/[\r\n]/.test(value) ? value : null;
        return {
            hash: value.hash.toLowerCase(),
            url: typeof data.url === 'string' ? data.url : null,
            etag: header(data.etag),
            lastModified: header(data.lastModified)
        };
    } catch {
        return null; // An invalid reference file is rebuilt after a successful download.
    }
}

/** Read-only project validation. Never creates files or contacts GitHub. */
export async function areCopilotInstructionsIntact(
    workspaceRoot: vscode.Uri,
    extensionRoot: vscode.Uri
): Promise<boolean> {
    const fileUri = vscode.Uri.joinPath(workspaceRoot, '.github', 'copilot-instructions.md');
    if (dirtyDocument(fileUri)) return false;
    const cache = parseCache(await readIfPresent(vscode.Uri.joinPath(extensionRoot, 'copilotHash.json')));
    if (!cache) return false;
    const contents = await readIfPresent(fileUri);
    return contents !== null && hasInstructions(contents) && sha256(contents) === cache.hash;
}

async function writeInstructions(fileUri: vscode.Uri, contents: Uint8Array, allowRepair: boolean): Promise<void> {
    const document = dirtyDocument(fileUri);
    if (!document) {
        await vscode.workspace.fs.writeFile(fileUri, contents);
        return;
    }
    if (!allowRepair) throw new LocalInstructionsChanged();
    // Regeneration explicitly replaces unsaved changes too, without leaving a
    // stale dirty editor that could overwrite the repaired file on the next save.
    const edit = new vscode.WorkspaceEdit();
    edit.replace(fileUri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        Buffer.from(contents).toString('utf8'));
    if (!await vscode.workspace.applyEdit(edit) || !await document.save()) {
        throw new Error('Copilot-Anweisungen konnten im geöffneten Editor nicht wiederhergestellt werden.');
    }
    const saved = await readIfPresent(fileUri);
    if (saved === null || sha256(saved) !== sha256(contents)) {
        throw new Error('Die Copilot-Anweisungen wurden beim Speichern verändert und stimmen nicht mit GitHub überein.');
    }
}

/**
 * Repair .github/copilot-instructions.md and check for a newer GitHub version.
 * copilotHash.json in the extension root stores the reference hash and HTTP validators.
 * Call only from the explicit create/regenerate-project command. Each call checks GitHub.
 * Empty GitHub placeholders are rejected without overwriting existing instructions.
 */
export async function syncCopilotInstructions(
    workspaceRoot: vscode.Uri,
    extensionRoot: vscode.Uri,
    githubRawUrl: string = COPILOT_INSTRUCTIONS_URL
): Promise<CopilotSyncResult> {
    const url = new URL(githubRawUrl);
    if (url.protocol !== 'https:') throw new Error('Die GitHub-Raw-URL muss HTTPS verwenden.');
    return queued(extensionRoot, () => synchronize(workspaceRoot, extensionRoot, url.href, true));
}

/** Automatic update for an existing, intact project; never repair local changes. */
export async function updateCopilotInstructionsIfIntact(
    workspaceRoot: vscode.Uri,
    extensionRoot: vscode.Uri,
    githubRawUrl: string = COPILOT_INSTRUCTIONS_URL
): Promise<CopilotSyncResult | null> {
    const url = new URL(githubRawUrl);
    if (url.protocol !== 'https:') throw new Error('Die GitHub-Raw-URL muss HTTPS verwenden.');
    return queued(extensionRoot, async () => {
        try { return await synchronize(workspaceRoot, extensionRoot, url.href, false); }
        catch (error) {
            if (error instanceof LocalInstructionsChanged) return null;
            throw error;
        }
    });
}

async function queued<T>(extensionRoot: vscode.Uri, action: () => Promise<T>): Promise<T> {
    const key = extensionRoot.toString();
    const previous = queues.get(key) ?? Promise.resolve();
    const operation = previous.then(action);
    const tail = operation.then(() => undefined, () => undefined);
    queues.set(key, tail);
    try { return await operation; }
    finally { if (queues.get(key) === tail) queues.delete(key); }
}

async function synchronize(
    workspaceRoot: vscode.Uri,
    extensionRoot: vscode.Uri,
    url: string,
    allowRepair: boolean
): Promise<CopilotSyncResult> {
    const folderUri = vscode.Uri.joinPath(workspaceRoot, '.github');
    const fileUri = vscode.Uri.joinPath(folderUri, 'copilot-instructions.md');
    const cacheUri = vscode.Uri.joinPath(extensionRoot, 'copilotHash.json');
    const cache = parseCache(await readIfPresent(cacheUri));
    const local = await readIfPresent(fileUri);
    const intact = local !== null && hasInstructions(local) && !dirtyDocument(fileUri)
        && cache !== null && sha256(local) === cache.hash;
    if (!allowRepair && !intact) throw new LocalInstructionsChanged();
    const useValidators = intact && cache.url === url;

    let response = await fetchFileFromGitHubIfModified(
        url, useValidators ? cache.lastModified : null, useValidators ? cache.etag : null
    );
    let current = await readIfPresent(fileUri);
    if (!allowRepair && (current === null || dirtyDocument(fileUri) || cache === null || sha256(current) !== cache.hash)) {
        throw new LocalInstructionsChanged();
    }

    // The file may have been changed/deleted while the HTTP request was running.
    // A 304 cannot repair it: request the actual contents in that case.
    if (response.content === null && (current === null || !hasInstructions(current) || dirtyDocument(fileUri)
        || cache === null || sha256(current) !== cache.hash)) {
        response = await fetchFileFromGitHubIfModified(url, null, null);
        current = await readIfPresent(fileUri);
    }

    let updated = false;
    let hash: string;
    if (response.content !== null) {
        if (!hasInstructions(response.content)) {
            throw new Error('Die Copilot-Datei auf GitHub ist noch leer. Vorhandene Anweisungen werden beibehalten.');
        }
        hash = sha256(response.content);
        if (current === null || sha256(current) !== hash || dirtyDocument(fileUri)) {
            if (allowRepair) await vscode.workspace.fs.createDirectory(folderUri);
            await writeInstructions(fileUri, response.content, allowRepair);
            updated = true;
        }
    } else {
        if (!cache || !current || !hasInstructions(current) || sha256(current) !== cache.hash) {
            throw new Error('GitHub lieferte keinen Inhalt zum Wiederherstellen der Copilot-Anweisungen.');
        }
        hash = cache.hash;
    }

    const next: CopilotCache = {
        hash, url, etag: response.etag, lastModified: response.lastModified
    };
    if (JSON.stringify(next) !== JSON.stringify(cache)) {
        // Never adopt a new reference hash before writing the workspace file succeeds.
        await vscode.workspace.fs.writeFile(cacheUri, Buffer.from(JSON.stringify(next, null, 2) + '\n', 'utf8'));
    }
    return { updated, hash, fileUri };
}
