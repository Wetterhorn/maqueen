import type { SerialPort } from 'serialport';

type Pending = {
    token: Buffer;
    resolve: (received: Buffer) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
};

/** One instance per protocol exchange; always dispose it in finally. */
export class SerialResponses {
    private buffer: Buffer = Buffer.alloc(0);
    private pending?: Pending;
    private failure?: Error;

    constructor(
        private readonly port: SerialPort,
        private readonly maxBytes = 64 * 1024
    ) {
        port.on('data', this.onData);
        port.on('error', this.onError);
        port.on('close', this.onClose);
    }

    waitFor(token: string | Buffer, timeoutMs = 2000, message=`Antwort-Timeout nach ${timeoutMs} ms.`): Promise<Buffer> {
        if (this.failure) return Promise.reject(this.failure);
        if (this.pending) return Promise.reject(new Error('Es läuft bereits eine Antwortanfrage.'));
        if (!this.port.isOpen || this.port.destroyed) {
            return Promise.reject(new Error('Der serielle Port ist nicht verfügbar.'));
        }
        const bytes = Buffer.from(token);
        if (bytes.length === 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            return Promise.reject(new Error('Token und Timeout müssen gültig sein.'));
        }

        return new Promise<Buffer>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.fail(new Error(message));
            }, timeoutMs);
            this.pending = { token: bytes, resolve, reject, timer };
            this.check();
        });
    }

    private readonly onData = (chunk: Buffer): void => {
        if (this.failure) return;
        if (this.buffer.length + chunk.length > this.maxBytes) {
            this.fail(new Error('Antwortpuffer ist zu groß.'));
            return;
        }
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.check();
    };

    private check(): void {
        const pending = this.pending;
        if (!pending) return;
        const index = this.buffer.indexOf(pending.token);
        // console.log('Buffer:', JSON.stringify(this.buffer.toString('utf8')));
        // console.log('Token:', JSON.stringify(pending.token.toString('utf8')));
        // console.log('Buffer hex:', this.buffer.toString('hex'));
        // console.log('Token hex:', pending.token.toString('hex'));
        // console.log('Index:', index);
        if (index < 0) return;

        const end = index + pending.token.length;
        const received = this.buffer.subarray(0, end);
        this.buffer = this.buffer.subarray(end);
        this.pending = undefined;
        clearTimeout(pending.timer);
        pending.resolve(received);
    }

    private readonly onError = (error: Error): void => this.fail(error);
    private readonly onClose = (): void => this.fail(new Error('Der serielle Port wurde geschlossen.'));

    private fail(error: Error): void {
        this.failure ??= error;
        this.buffer = Buffer.alloc(0);
        const pending = this.pending;
        this.pending = undefined;
        if (pending) {
            clearTimeout(pending.timer);
            pending.reject(this.failure);
        }
    }

    dispose(): void {
        this.fail(new Error('Antwortempfänger wurde beendet.'));
        this.port.off('data', this.onData);
        this.port.off('error', this.onError);
        this.port.off('close', this.onClose);
    }
}