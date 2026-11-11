import * as https from 'https';
import type { IncomingMessage } from 'http';

export interface GitHubFileValidators {
    lastModified: string | null;
    etag: string | null;
}

export interface GitHubFileResult extends GitHubFileValidators {
    content: Uint8Array | null;
    /** false means HTTP 304; a 200 response still needs a local content comparison. */
    modified: boolean;
}

export interface GitHubDownloadOptions {
    /** Total time for redirects, response headers and the complete body. */
    timeoutMs?: number;
    maxBytes?: number;
    maxRedirects?: number;
    agent?: https.Agent;
}

/** Download the complete file. The existing return type is preserved. */
export async function fetchFileFromGitHub(
    url: string,
    options: GitHubDownloadOptions = {}
): Promise<Uint8Array> {
    const result = await fetchFileFromGitHubIfModified(url, null, null, options);
    if (result.content === null) throw new Error('Unerwartete Antwort ohne Dateiinhalt.');
    return result.content;
}

/** ETag is preferred; lastModified must come from the server, not the local clock. */
export async function fetchFileFromGitHubIfModified(
    url: string,
    lastModified: string | null,
    etag: string | null = null,
    { timeoutMs = 15000, maxBytes = 8 * 1024 * 1024, maxRedirects = 5, agent }: GitHubDownloadOptions = {}
): Promise<GitHubFileResult> {
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647
        || !Number.isSafeInteger(maxBytes) || maxBytes < 0
        || !Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
        throw new Error('Ungültige Download-Grenzwerte.');
    }
    let current = new URL(url);
    const headers: Record<string, string> = { 'User-Agent': 'maqueen-vscode-extension' };
    if (etag) headers['If-None-Match'] = etag;
    else if (lastModified) headers['If-Modified-Since'] = lastModified;

    const controller = new AbortController();
    const timeoutError = new Error(`Download-Timeout nach ${timeoutMs} ms: ${url}`);
    const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);

    try {
        for (let redirects = 0; ; redirects++) {
            if (current.protocol !== 'https:') throw new Error('Für Downloads ist HTTPS erforderlich.');

            const response = await new Promise<IncomingMessage>((resolve, reject) => {
                const request = https.get(current, { headers, agent, signal: controller.signal }, incoming => {
                    // Also observe errors between the header callback and iterator setup,
                    // and while discarding an error/redirect response in finally.
                    incoming.on('error', reject);
                    resolve(incoming);
                });
                request.on('error', reject);
            });

            try {
                const status = response.statusCode;
                if (status !== undefined && [301, 302, 303, 307, 308].includes(status)) {
                    if (!response.headers.location) throw new Error(`HTTP ${status}: Weiterleitungsziel fehlt.`);
                    if (redirects >= maxRedirects) throw new Error('Zu viele HTTP-Weiterleitungen.');
                    current = new URL(response.headers.location, current);
                    continue;
                }

                if (status === 304) {
                    if (!etag && !lastModified) throw new Error('HTTP 304 ohne bedingte Anfrage.');
                    return {
                        content: null,
                        modified: false,
                        lastModified: response.headers['last-modified'] ?? lastModified,
                        etag: response.headers.etag ?? etag
                    };
                }
                if (status !== 200) throw new Error(`Dateiabruf fehlgeschlagen: HTTP ${status} (${current.href}).`);

                const chunks: Buffer[] = [];
                let length = 0;
                for await (const chunk of response) {
                    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    length += bytes.length;
                    if (length > maxBytes) throw new Error(`Datei überschreitet ${maxBytes} Bytes.`);
                    chunks.push(bytes);
                }
                if (!response.complete) throw new Error('HTTP-Antwort wurde unvollständig übertragen.');
                return {
                    content: Buffer.concat(chunks, length),
                    modified: true,
                    lastModified: response.headers['last-modified'] ?? null,
                    etag: response.headers.etag ?? null
                };
            } finally {
                // Also release unread bodies on redirects, 304 and errors.
                response.destroy();
            }
        }
    } catch (error) {
        if (controller.signal.aborted) throw timeoutError;
        throw error;
    } finally {
        clearTimeout(timer);
    }
}
