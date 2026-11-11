import type { SerialPort } from 'serialport';
import { rawPaste, type RawPasteOptions } from './rawPaste';

export interface RawPasteFileOptions extends RawPasteOptions {
    /** Payload bytes per Python script; this is not the serial flow-control window. */
    blockBytes?: number;
}

/** Encode arbitrary bytes as an ASCII-only Python bytes literal. */
function pythonBytes(bytes: Buffer): string {
    return "b'" + Array.from(bytes, byte => '\\x' + byte.toString(16).padStart(2, '0')).join('') + "'";
}

/**
 * Overwrite a file in the micro:bit's flat filesystem without executing its contents.
 * Confirm each write, close the file, then compare every stored byte and EOF.
 * Requires one open port and exclusive access throughout the complete upload.
 * Leaves raw REPL active; no reboot. A failed upload can leave a partial target file.
 */
export async function writeFileRawPaste(
    port: SerialPort,
    filename: string,
    contents: string | Buffer,
    { blockBytes = 256, ...options }: RawPasteFileOptions = {}
): Promise<void> {
    if (!filename || filename === '.' || filename === '..' || /[/\\\x00-\x1f\x7f]/.test(filename)
        || Buffer.byteLength(filename, 'utf8') > 120) {
        throw new Error('Ungültiger micro:bit-Dateiname (maximal 120 UTF-8-Bytes, keine Verzeichnisse).');
    }
    if (!Number.isInteger(blockBytes) || blockBytes < 1 || blockBytes > 4096) {
        throw new Error('blockBytes muss eine ganze Zahl zwischen 1 und 4096 sein.');
    }
    const data = Buffer.from(contents);
    const name = pythonBytes(Buffer.from(filename, 'utf8')) + ".decode('utf8')";
    const fd = '_mq_upload_file'; // Reserved only for this helper, including cleanup after failure.

    const run = async (script: string): Promise<void> => {
        const result = await rawPaste(port, 'import gc\ngc.collect()\n' + script + '\n', options);
        if (result.stderr.length > 0) {
            throw new Error(`Datei ${filename}: ${result.stderr.toString('utf8').trimEnd()}`);
        }
    };
    const cleanup = [
        `if '${fd}' in globals():`,
        '    try:',
        `        if ${fd} is not None:`,
        `            ${fd}.close()`,
        '    finally:',
        `        del ${fd}`
    ].join('\n');

    let failed = false;
    try {
        // Close a leftover handle from a previously interrupted call first.
        await run(cleanup + `\n${fd} = None\n${fd} = open(${name}, 'wb')`);
        for (let offset = 0; offset < data.length; offset += blockBytes) {
            const block = data.subarray(offset, offset + blockBytes);
            await run([
                `if ${fd}.write(${pythonBytes(block)}) != ${block.length}:`,
                "    raise OSError('Unvollstaendiger Schreibvorgang')"
            ].join('\n'));
        }

        // Reopen only after close has succeeded, so the committed file is checked.
        await run(`${fd}.close()\n${fd} = None\n${fd} = open(${name}, 'rb')`);
        for (let offset = 0; offset < data.length; offset += blockBytes) {
            const block = data.subarray(offset, offset + blockBytes);
            await run([
                `if ${fd}.read(${block.length}) != ${pythonBytes(block)}:`,
                `    raise OSError('Dateipruefung fehlgeschlagen bei Byte ${offset}')`
            ].join('\n'));
        }
        await run(`if ${fd}.read(1) != b'':\n    raise OSError('Datei ist zu lang')`);
    } catch (error) {
        failed = true;
        throw error;
    } finally {
        try { await run(cleanup); }
        catch (error) {
            // Preserve the actual upload error if the port also prevents cleanup.
            if (!failed) throw error;
        }
    }
}
