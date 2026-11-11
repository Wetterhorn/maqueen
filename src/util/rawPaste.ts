import type { SerialPort } from 'serialport';

export interface RawPasteOptions {
    ioTimeoutMs?: number;
    executionTimeoutMs?: number;
    trace?: (direction: 'TX' | 'RX', bytes: Buffer) => void;
}

export interface RawPasteResult {
    stdout: Buffer;
    stderr: Buffer;
}

/**
 * Execute a finite Python script using MicroPython's raw-paste protocol.
 * Requires an open port and exclusive ownership of all writes during this call.
 * Returns at the raw REPL prompt; Python exceptions are returned in stderr.
 * No soft reset, automatic reconnect or fallback to unregulated raw writes.
 */
export async function rawPaste(
    port: SerialPort,
    source: string | Buffer,
    { ioTimeoutMs = 5000, executionTimeoutMs = 30000, trace }: RawPasteOptions = {}
): Promise<RawPasteResult> {
    for (const timeout of [ioTimeoutMs, executionTimeoutMs]) {
        if (!Number.isFinite(timeout) || timeout <= 0) {
            throw new Error('Timeouts müssen positiv und endlich sein.');
        }
    }
    const code = Buffer.from(source);
    // These literal bytes are protocol controls, not Python source text.
    if (code.includes(0x03) || code.includes(0x04)) {
        throw new Error('Quelltext darf keine wörtlichen Ctrl-C-/Ctrl-D-Bytes enthalten.');
    }
    const EOT = Buffer.from([0x04]);
    const serial = new RawPasteConnection(port, trace);

    try {
        // 1. Stop a running program and confirm entry to raw REPL.
        await serial.write(Buffer.from([0x0d, 0x03, 0x03, 0x01]), ioTimeoutMs);
        await serial.readUntil(Buffer.from('raw REPL; CTRL-B to exit\r\n>'), ioTimeoutMs);

        // 2. Negotiate raw-paste: Ctrl-E, 'A', Ctrl-A.
        await serial.write(Buffer.from([0x05, 0x41, 0x01]), ioTimeoutMs);
        const reply = await serial.readExactly(2, ioTimeoutMs);
        if (reply.equals(Buffer.from('ra'))) {
            // Older firmware responds with the raw REPL banner again.
            await serial.readUntil(Buffer.from('w REPL; CTRL-B to exit\r\n>'), ioTimeoutMs);
            throw new Error('Diese Firmware unterstützt Raw-Paste nicht.');
        }
        if (reply.equals(Buffer.from([0x52, 0x00]))) {
            throw new Error('Diese Firmware unterstützt Raw-Paste nicht.');
        }
        if (!reply.equals(Buffer.from([0x52, 0x01]))) {
            throw new Error(`Ungültige Raw-Paste-Antwort: ${reply.toString('hex')}`);
        }

        // 3. The window increment is a uint16 in little-endian byte order.
        const increment = (await serial.readExactly(2, ioTimeoutMs)).readUInt16LE(0);
        if (increment === 0) throw new Error('Ungültige Fenstergröße: 0.');
        let credit = increment;
        let offset = 0;
        let stoppedEarly = false;

        // 4. Each received 0x01 grants one more window, including the initial
        //    extra 0x01 that many boards send immediately after the header.
        transfer: while (offset < code.length) {
            while (credit === 0 || serial.available > 0) {
                const control = (await serial.readExactly(1, ioTimeoutMs))[0];
                if (control === 0x01) {
                    credit += increment;
                } else if (control === 0x04) {
                    // E.g. a syntax error while compiling the incoming source.
                    // Acknowledge the abort; never send the remaining source.
                    await serial.write(EOT, ioTimeoutMs);
                    stoppedEarly = true;
                    break transfer;
                } else {
                    throw new Error(`Ungültiges Flusskontrollbyte: 0x${control.toString(16)}`);
                }
            }

            // Byte slices preserve UTF-8 even if a character spans two writes.
            // The small upper bound lets us react promptly to an early abort.
            const length = Math.min(credit, code.length - offset, 256);
            await serial.write(code.subarray(offset, offset + length), ioTimeoutMs);
            offset += length;
            credit -= length;
        }

        // 5. End source input and consume its acknowledgement. Unlike standard
        //    raw REPL, raw-paste acknowledges with 0x04, NOT with 'OK'.
        if (!stoppedEarly) {
            await serial.write(EOT, ioTimeoutMs);
            for (;;) {
                const control = (await serial.readExactly(1, ioTimeoutMs))[0];
                if (control === 0x04) break;
                if (control !== 0x01) {
                    throw new Error('Ungültige Bestätigung am Ende der Übertragung.');
                }
            }
        }

        // 6. Execution result: stdout, EOT, stderr, EOT, raw prompt.
        // Use one deadline for the entire execution, not one per output chunk.
        const deadline = Date.now() + executionTimeoutMs;
        const remaining = (): number => Math.max(1, deadline - Date.now());
        const stdout = await serial.readUntil(EOT, remaining());
        const stderr = await serial.readUntil(EOT, remaining());
        const prompt = await serial.readExactly(1, ioTimeoutMs);
        if (prompt[0] !== 0x3e) throw new Error('Raw-REPL-Prompt fehlt.');
        if (stoppedEarly && stderr.length === 0) {
            throw new Error('Das Gerät hat den Empfang vorzeitig abgebrochen.');
        }
        return { stdout, stderr };
    } finally {
        serial.dispose();
    }
}

/** Binary framing, write completion and timeouts, separate from the protocol. */
class RawPasteConnection {
    private buffer: Buffer = Buffer.alloc(0);
    private failure?: Error;
    private pending?: { check: () => void; reject: (error: Error) => void };

    constructor(
        private readonly port: SerialPort,
        private readonly trace?: RawPasteOptions['trace']
    ) {
        port.on('data', this.onData);
        port.on('error', this.onError);
        port.on('close', this.onClose);
    }

    get available(): number { return this.buffer.length; }

    private readonly onData = (chunk: Buffer): void => {
        if (this.failure) return;
        try { this.trace?.('RX', Buffer.from(chunk)); }
        catch (error) {
            this.fail(error instanceof Error ? error : new Error(String(error)));
            return;
        }
        if (this.buffer.length + chunk.length > 8 * 1024 * 1024) {
            this.fail(new Error('Raw-Paste-Antwort überschreitet 8 MiB.'));
            return;
        }
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.pending?.check();
    };
    private readonly onError = (error: Error): void => this.fail(error);
    private readonly onClose = (error?: Error | null): void =>
        this.fail(error ?? new Error('Serieller Port wurde geschlossen.'));

    private fail(error: Error): void {
        this.failure ??= error;
        this.pending?.reject(this.failure);
    }

    // Only one operation at a time. All incoming bytes are buffered even
    // during a write, so replies arriving before its callback cannot get lost.
    private operation<T>(
        timeoutMs: number,
        start: (resolve: (value: T) => void, reject: (error: Error) => void) => void,
        check: () => void = () => {}
    ): Promise<T> {
        if (this.failure) return Promise.reject(this.failure);
        if (this.pending) return Promise.reject(new Error('Paralleler Protokollzugriff.'));
        if (!this.port.isOpen || this.port.destroyed || !this.port.writable) {
            return Promise.reject(new Error('Serieller Port ist nicht verfügbar.'));
        }
        return new Promise<T>((resolve, reject) => {
            const finish = (error?: Error, value?: T): void => {
                if (this.pending !== pending) return;
                clearTimeout(timer);
                this.pending = undefined;
                if (error) {
                    this.failure ??= error;
                    reject(this.failure);
                } else {
                    resolve(value as T);
                }
            };
            const pending = { check, reject: (error: Error) => finish(error) };
            const timer = setTimeout(() => finish(new Error('Raw-Paste-Timeout.')), timeoutMs);
            this.pending = pending;
            try { start(value => finish(undefined, value), error => finish(error)); }
            catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
        });
    }

    write(bytes: Buffer, timeoutMs: number): Promise<void> {
        return this.operation<void>(timeoutMs, (resolve, reject) => {
            this.trace?.('TX', Buffer.from(bytes));
            this.port.write(bytes, error => error ? reject(error) : resolve());
        });
    }

    private read(
        take: () => Buffer | undefined,
        timeoutMs: number
    ): Promise<Buffer> {
        let check = (): void => {};
        return this.operation<Buffer>(timeoutMs, resolve => {
            check = () => {
                const value = take();
                if (value !== undefined) resolve(value);
            };
            check();
        }, () => check());
    }

    readExactly(length: number, timeoutMs: number): Promise<Buffer> {
        return this.read(() => {
            if (this.buffer.length < length) return undefined;
            const value = this.buffer.subarray(0, length);
            this.buffer = this.buffer.subarray(length);
            return value;
        }, timeoutMs);
    }

    /** Return the bytes before the delimiter; consume the delimiter too. */
    readUntil(delimiter: Buffer, timeoutMs: number): Promise<Buffer> {
        return this.read(() => {
            const index = this.buffer.indexOf(delimiter);
            if (index < 0) return undefined;
            const value = this.buffer.subarray(0, index);
            this.buffer = this.buffer.subarray(index + delimiter.length);
            return value;
        }, timeoutMs);
    }

    dispose(): void {
        this.fail(new Error('Raw-Paste-Verbindung wurde beendet.'));
        this.port.off('data', this.onData);
        this.port.off('error', this.onError);
        this.port.off('close', this.onClose);
    }
}
