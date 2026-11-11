import * as vscode from 'vscode';
import { ActionHolder, MutationListener } from "./interfaces";
import { ReadlineParser, SerialPort } from 'serialport';
import { CustomError, Exception, getErrorMessage, errorType, error2user, forwardError } from '../exception';
import { OutputDataAnalyser } from '../util/OutputDataAnalyser';
import { getRootPath } from '../util/pathHelper';
import path from 'path';
import { ListenerInput } from '../types';
import { flashMicrobit } from '../util/flashMicrobit';
import { exec } from 'child_process';
import { l10n } from 'vscode';
import { ErrorType, logError } from '../util/logErrors';
import { verbose } from '../util/verbose';
import { once } from 'events';
import { SerialResponses } from '../util/SerialResponses';
import { rawPaste } from '../util/rawPaste';
import { writeFileRawPaste } from '../util/writeFileRawPaste';

const MICROBIT_VID = "0d28"; // micro:bit / DAPLink (case-insensitive)

/**
 * 
 */
export class MicrobitController implements ActionHolder {
    readonly BAUD_RATE = 115200;
    private mutationListener: MutationListener[] = [];
    private port: SerialPort | undefined;
    private analyser;
    private context: vscode.ExtensionContext;
    private parserRegistered = false;
    private lock = false;
    private toggle = true;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.analyser = new OutputDataAnalyser();
        this.analyser.setFilter();
    }

    private createActionFrame(action: Function, finalAction?: Function) {
        const actionFrame = async (p: any | void) => {
            if (this.lock) return;
            try {
                this.lock = true;
                await action(p);
            } catch (err: any) {
                logError(ErrorType.ACTION, "actionFrame", err);
                await error2user(err);
            } finally {
                if (finalAction) {
                    finalAction();
                }
                this.lock = false;
            }
        };
        return actionFrame;
    }

    public getAction(actionId: string) {
        switch (actionId) {
            case 'softreboot':
                return this.createActionFrame(
                    async () => {
                        //this.analyser.clear();
                        const port = await this.connectToMicrobit();
                        const responses = new SerialResponses(port);

                        try {
                            // 1. Programm unterbrechen und normalen REPL bestätigen.
                            await this.exchange(port, responses, '>>>', [0x03, 0x02]);

                            // 2. Erst jetzt den Soft-Reboot auslösen.
                            await this.exchange(port, responses, 'MPY: soft reboot', [0x04]);
                        } finally {
                            responses.dispose();
                        }
                    }
                );
            case 'stop':
                return this.createActionFrame(
                    async () => {
                        //this.analyser.clear();
                        const port = await this.connectToMicrobit();
                        const responses = new SerialResponses(port);

                        try {
                            await this.exchange(port, responses, '>>>', [0x03]);
                        } finally {
                            responses.dispose();
                        }
                    }
                );
            case 'closePort':
                return this.createActionFrame(
                    async () => {
                        await this.close();
                        this.analyser.messageToOuputChannel(l10n.t('Port has been closed.'));
                    }
                );
            case 'uploadFile':
                return this.createActionFrame(
                    async (file: any) => {
                        vscode.commands.executeCommand('setContext', 'maqueen.fileUploadRunning', true);
                        const opened = vscode.workspace.textDocuments.find(d => d.uri.toString() === file.path.toString());
                        const doc = opened ?? await vscode.workspace.openTextDocument(file.path);
                        doc.save();
                        this.analyser.clear();
                        this.analyser.setOn(false);
                        const port = await this.connectToMicrobit();
                        const responses = new SerialResponses(port);
                        try { await this.exchange(port, responses, '>>>', [0x03, 0x02]); }
                        finally { responses.dispose(); }
                        await this.connectToMicrobit();
                        //await this.checkMicroPython();
                        this.analyser.messageToOuputChannel(l10n.t({ message: 'Uploading {0}...', args: [file.label], comment: ['{0}: file name'] }));
                        await this.fileUpload(file);
                    },
                    () => {
                        this.analyser.setFilter();
                        this.analyser.setUserMessages(true);
                        vscode.commands.executeCommand('setContext', 'maqueen.fileUploadRunning', false);
                    }
                );
            case 'flash':
                return this.createActionFrame(async () => {
                    this.analyser.setUserMessages(false);
                    this.refreshListener({ sourceId: 'prep', progressAnimation: true });
                    await flashMicrobit(this.context.extensionPath, this.analyser.messageToOuputChannel);
                }, () => {
                    this.analyser.setUserMessages(true);
                    this.refreshListener({ sourceId: 'prep', progressAnimation: false });
                });
            case 'ctrla':
                return this.createActionFrame(
                    async () => {
                        this.analyser.setOn(true);
                        this.analyser.setUserMessages(true);
                        await this.connectToMicrobit();
                        await this.write(Buffer.from([0x01]));
                        await sleep(200);
                        await this.write(Buffer.from([0x05]));
                        await sleep(200);
                        await this.write("A");
                        await sleep(200);
                        await this.write(Buffer.from([0x01]));
                        await sleep(200);
                        this.analyser.setFilter();
                    }
                );
            case 'ctrlb':
                return this.createActionFrame(
                    async () => {
                        this.analyser.setOn(true);
                        this.analyser.setUserMessages(true);
                        await this.connectToMicrobit();
                        await this.write(Buffer.from([0x02]));
                        await sleep(200);
                        this.analyser.setFilter();
                    }
                );
            case 'ctrlc':
                return this.createActionFrame(
                    async () => {
                        this.analyser.setOn(true);
                        this.analyser.setUserMessages(true);
                        await this.connectToMicrobit();
                        await this.write(Buffer.from([0x03]));
                        await sleep(200);
                        this.analyser.setFilter();
                    }
                );
            case 'ctrld':
                return this.createActionFrame(
                    async () => {
                        this.analyser.setOn(true);
                        this.analyser.setUserMessages(true);
                        await this.connectToMicrobit();
                        await this.write(Buffer.from([0x05]));
                        await sleep(200);
                        await this.write("A");
                        await sleep(200);
                        await this.write(Buffer.from([0x01]));
                        await sleep(200);
                        //await this.write(Buffer.from([0x04]));
                        await sleep(200);
                        this.analyser.setFilter();
                    }
                );
            case 'ctrle':
                return this.createActionFrame(
                    async () => {
                        this.analyser.setOn(true);
                        this.analyser.setUserMessages(true);
                        await this.connectToMicrobit();
                        await this.write(Buffer.from([0x05]));
                        await sleep(200);
                        this.analyser.setFilter();
                    }
                );
            case 'sendCommandToMicrobit':
                return this.createActionFrame(
                    async () => {
                        this.analyser.setOn(true);
                        this.analyser.setUserMessages(true);
                        await this.connectToMicrobit();
                        let c = await vscode.window.showInputBox({
                            prompt: "Befehl",
                            placeHolder: "Pythonbefehl"
                        });
                        if (typeof c === 'string') { await this.execute([c], false, false); }
                        await sleep(200);
                    }
                );
            case 'deleteFilesOnMicrobit':
                return this.createActionFrame(
                    async () => {
                        this.analyser.setUserMessages(false);
                        await this.connectToMicrobit();
                        //this.port!.write(Buffer.from([0x03]));
                        //this.port!.write(Buffer.from([0x03]));
                        await sleep(100);
                        // const files = (await vscode.workspace.fs.readDirectory(vscode.Uri.file(getRootPath(this.context)))).filter(([fileName, fileType]) => fileType === vscode.FileType.File && fileName.match(/^[a-zA-Z0-9_]+\.py$/)).map(([fileName, fileType]) => fileName);
                        // await this.deleteFiles(files);
                        await this.deleteAllFiles();
                        this.analyser.messageToOuputChannel(l10n.t('All files on the Micro:bit have been deleted.'));
                    }
                );
            case 'ejectDevice':
                return this.createActionFrame(
                    async () => {
                        this.analyser.messageToOuputChannel(l10n.t('Try to eject Micro:bit drive...'));
                        await ejectDevice(() => this.analyser.messageToOuputChannel(l10n.t('Micro:bit drive has been ejected.')), () => this.analyser.messageToOuputChannel(l10n.t('No drive was selected.')));

                    }
                );
        }
        throw new Exception('getAction does not recognise a command for passed actionId', 300);
    }

    private async lookForMicrobit(): Promise<string> {
        const p: Promise<string> = new Promise(async (resolve, reject) => {
            const portList = await SerialPort.list();
            const port = portList.filter(p => p.vendorId?.toLowerCase() === MICROBIT_VID);
            verbose(`Portlist: ${JSON.stringify(portList)}`);
            if (port.length === 1) {
                verbose(`Port: ${JSON.stringify(port[0])}`);
                resolve(port[0].path);
            } else if (port.length > 1) {
                reject(new CustomError("More than one microbit was detected.", errorType.moreThanOneMicrobit, 302));
            } else {
                reject(new CustomError("No microbit was recognised.", errorType.noMicrobit, 303));
            }
        });
        return p;
    }

    private openPort = async (port: SerialPort): Promise<void> => {

        try {
            port.open();                     // startet asynchron
            await Promise.race([
                once(port, 'open'),           // Erfolg
                once(port, 'error')           // Fehler direkt abfangen
            ]);
            await new Promise<void>(resolve =>
                port.set({ dtr: true, rts: true }, () => resolve())
            );
            // optional: kurzes Delay für ARM-Treiber
            await new Promise(r => setTimeout(r, 200));
        } catch (err) {
            logError(ErrorType.CONNECTION, "openPort", err);
            throw err;
        }
    };



    private async write(message: string | Buffer): Promise<void> {
        let port: SerialPort;

        try {
            port = await this.open();
        } catch (err: unknown) {
            throw forwardError(
                err,
                err instanceof Error ? err.message : String(err),
                errorType.noPort,
                316
            );
        }

        await new Promise<void>((resolve, reject) => {
            port.write(message, err => {
                if (err) {
                    reject(forwardError(err, err instanceof Error ? err.message : String(err), errorType.serialWrite, 324));
                    return;
                }
                resolve();
            });
        });
    }

    private exchange = async (
        port: SerialPort,
        responses: SerialResponses,
        expected: string,
        bytes: number[]
    ): Promise<void> => {
        const response = responses.waitFor(expected, 5000, expected);

        const sending = new Promise<void>((resolve, reject) => {
            port.write(Buffer.from(bytes), error => {
                if (error) reject(error);
                else resolve();
            });
        });

        const [received] = await Promise.all([response, sending]);

        console.log(
            'Antwort bestätigt:',
            JSON.stringify(received.toString('utf8'))
        );
    };

    private open = async (): Promise<SerialPort> => {
        const stalePort = this.port;

        if (stalePort?.destroyed) {
            // Einen bereits laufenden Schließvorgang abwarten.
            if (stalePort.closing) {
                await once(stalePort, 'close', {
                    signal: AbortSignal.timeout(3000)
                });
            }

            // Falls die native Verbindung noch offen ist: freigeben.
            if (stalePort.isOpen) {
                await new Promise<void>((resolve, reject) => {
                    stalePort.close(err => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
            }

            stalePort.unpipe();
            this.port = undefined;
            this.parserRegistered = false;
        }
        if (this.port?.isOpen) return this.port;
        if (this.port) {
            try {
                await this.openPort(this.port);
                return this.port;
            } catch (err) {
                logError(ErrorType.CONNECTION, "try open port", err);
                try { this.port.removeAllListeners(); this.port.destroy(); } catch { }
                this.port = undefined;
            }
        }
        //port konnte nicht geöffnet werden oder es existiert noch keiner.
        this.parserRegistered = false;
        try {
            const portPath = await this.lookForMicrobit();
            const p = new SerialPort({ path: portPath, baudRate: this.BAUD_RATE, autoOpen: false });
            this.port = p;
            await this.openPort(p);
            //p.on("error", (err)=>{logError(ErrorType.CONNECTION, "portError", err);})
            return p;
        } catch (err) {
            logError(ErrorType.CONNECTION, "failed to find or open a port", err);
            throw new CustomError('No serial port could be opened.', errorType.noPort, 315);
        }
    }

    private async close() {
        const port = await this.open();
        try {
            port.close();
        } catch (err: any) {
            throw new CustomError('Port could not be closed.', errorType.portClose, 313);
        } finally {
            this.port = undefined;
            this.parserRegistered = false;
        }
    }

    private async connectToMicrobit(): Promise<SerialPort> {
        try {
            const port = await this.open();

            if (!this.parserRegistered) {
                const parser = new ReadlineParser({
                    delimiter: '\r\n'
                });

                // Listener vor dem Anschließen des Streams registrieren.
                parser.on('data', line => {
                    this.analyser.dataHandler(line);
                });

                port.pipe(parser);
                this.parserRegistered = true;
            }

            return port;
        } catch (err: unknown) {
            throw forwardError(
                err,
                err instanceof Error ? err.message : String(err),
                errorType.noPort,
                316
            );
        }
    }
    async checkMicroPython() {
        try {
            const r = await this.execute([{ command: 'print("hello")', function: async () => await this.analyser.waitForPattern(/hello$/, 1000, 'timeOutSayHello') }], false, false);
        } catch (err: any) {
            throw new CustomError('The Micro:bit does not react as desired. Press the reset button on Micro:bit.', errorType.pressResetButton, 320);
        }
    }


    async put(filePath: string, target: string, softReboot: boolean = false): Promise<void> {
        const port = await this.connectToMicrobit();
        try {
            const data = (await vscode.workspace.fs.readFile(vscode.Uri.file(filePath)));
            const code = Buffer.from(data);
            await writeFileRawPaste(
                port,
                target,
                Buffer.from(code),
                {
                    blockBytes: 256,
                    trace: (direction, bytes) => {
                        console.log(direction, bytes.toString('hex'));
                    }
                }
            );



            // if (stderr.length > 0) {
            //     throw new Error(stderr.toString('utf8'));
            // }
            this.analyser.messageToOuputChannel(l10n.t({ message: '{0} was successfully uploaded.', args: [path.basename(filePath)], comment: ['{0}: file name'] }));

            if (softReboot) {
                const port = await this.connectToMicrobit();
                const responses = new SerialResponses(port);

                try {
                    // 1. Programm unterbrechen und normalen REPL bestätigen.
                    await this.exchange(port, responses, '>>>', [0x03, 0x02]);

                    // 2. Erst jetzt den Soft-Reboot auslösen.
                    await this.exchange(port, responses, 'MPY: soft reboot', [0x04]);
                } finally {
                    responses.dispose();
                }
            }
        }

        //return stdout.toString('utf8');
        catch (err: any) {
            throw forwardError(err, getErrorMessage(err, false), errorType.fileUpload, 308);
        }
    }

    //Sendet ein File (filePath) und lädt es unter dem Namen target auf den micro:bit
    async put2(filePath: string, target: string, softReboot: boolean = false): Promise<void> {
        return new Promise(async (resolve, reject) => {
            //OutputDataAnalyser.getInstance().setOffUntilPattern(RegExp(`^MPY: soft reboot`));
            try {
                await this.prepareMicrobitToWriteFile(target);
                this.analyser.observeData((data) => {
                    const m = data.match(/^s [0-9]+/);
                    if (m) {
                        const mem = parseInt(m[0].replace(/^s /, ''));
                        if (mem < 5000) {
                            return true;
                        }
                    }
                    return false;
                });
                let commands: { command: string, function: Function }[];

                this.toggle = !this.toggle;
                //const fileUri = vscode.Uri.file(`${filePath}${this.toggle ? 'x' : ''}`);
                // const fileUri = vscode.Uri.file(filePath);
                // let data = (await vscode.workspace.fs.readFile(fileUri)).toString();
                const data = (await vscode.workspace.fs.readFile(vscode.Uri.file(filePath)));
                const bytes = Buffer.from(data);
                commands = [
                    { command: `import gc`, function: async () => await this.analyser.waitForPattern(/>>>/, 5000, `timeout: import gc`) },
                    { command: `gc.collect()`, function: async () => await this.analyser.waitForPattern(/>>>/, 5000, `timeout: gc.collect()`) },
                    // { command: `print("MEM", gc.mem_free())`, function: async () => await this.analyser.waitForPattern(/>>>/,5000,`timeout:print mem`) },
                    { command: `fd = open("${target}", "wb")`, function: () => sleep(50) },
                    { command: 'f = fd.write', function: async () => await this.analyser.waitForPattern(/>>>/, 5000, `timeout: write-`) },
                    // {
                    //     command: "f(\"tsbewegung\\r\\n    - fährt solange vorwärts, bis ein ande\")",
                    //     function: async () => await this.analyser.waitForPatern(/^[1-9][0-9]/, 5000, 'timeOut'),
                    //   }
                ];
                // data = data.replace(/#.*/gm, '');

                //data = data.replace(/ä/, '\\xc3\\xa4').replace(/ö/, '\\xc3\\xb6').replace(/ü/, '\\xc3\\xbc').replace(/Ä/, '\\xc3\\x84').replace(/Ö/, '\\xc3\\x96').replace(/Ü/, '\\xc3\\x9C');
                const bd = Buffer.from(data);
                for (let i = 0; i < bytes.length; i += 54) {
                    const chunk = bytes.subarray(i, i + 54);
                    const byteValues = Array.from(chunk).join(',');
                    commands.push({
                        command: `f(bytes([${byteValues}]))`,
                        function: async () =>
                            await this.analyser.waitForPattern(
                                /^[1-9][0-9]*/,
                                5000,
                                `timeout: ${i}`
                            )
                    });
                }
                commands.push({ command: "fd.close()", function: async () => await this.analyser.waitForPattern(/^>>> fd.close\(\)$/, 5000, 'timeOut: fd.close()') });

                await this.execute(commands, softReboot, false, l10n.t({ message: '{0} was successfully uploaded.', args: [path.basename(filePath)], comment: ['{0}: file name'] }));
                resolve();
            } catch (err: any) {
                reject(forwardError(err, getErrorMessage(err, false), errorType.fileUpload, 308));
            }
        });
    }

    /**
     * Führt Befehle auf Microbit (Micropython) aus
     * @param commands Falls die Variante mit function: Nach einem Kommando wird die Funktion aufgerufen, andernfalls 10ms gewartet.
     * @param enterLast Falls true und row mode:  port.write(Buffer.from([0x04])) (Enter), ansonsten Soft-Reboot (port.write(Buffer.from('\r\x02','utf-8'));)
     * @param row Versetzen in row mode
     */
    private async execute(commands: string[] | { command: string, function: Function }[], enterLast: boolean = false, raw: boolean = true, message?: string): Promise<void> {
        //this.analyser.setOn(true);
        let responses = undefined;
        try {
            const port = await this.connectToMicrobit();
            responses = new SerialResponses(port);
            // 1. Programm unterbrechen und normalen REPL bestätigen.
            await this.exchange(port, responses, '>>>', [0x03, 0x02]);
            if (raw) {
                await this.raw_on();
            }
            let memmoryOverflow = false;
            for (let command of commands) {
                const com = typeof command === 'string' ? command + '\r' : command.command + '\r';
                const commandBuffer = Buffer.from(com, 'utf-8');
                let count = 0;
                const send = new Promise<void>((resolve, reject) => {
                    port.write(commandBuffer, error => {
                        if (error) reject(error);
                        else resolve();
                    });
                });
                // for (let i = 0; i < com.length; i = i + 32) {
                //     (await this.open()).write(commandBuffer.subarray(i, i + 32),(err) => {
                //         if (err) {
                //           return console.log('Fehler beim Schreiben: ', err.message);
                //         }
                //         console.log('Nachricht gesendet:');
                //       });
                //     //await sleep(1);
                //     count++;
                // }
                if (this.analyser.getObserveDataFlag()) {
                    memmoryOverflow = true;
                    break;
                }
                if (!enterLast && raw) {//nur im row Mode, sonst softreboot.
                    //(await this.open()).write(Buffer.from([0x04]));
                }
                //console.log(await command.do());
                const waiting = new Promise((resolve, reject) => {
                    if (typeof command !== 'string') {
                        try {
                            resolve(command.function());
                            //await sleep(1000);
                        } catch (err) {
                            logError(ErrorType.EXECUTE, "executeCommand", err);
                            reject(new CustomError('In the execute function, a function linked to a command could not be executed. Error: ' + getErrorMessage(err, true), errorType.fileUpload, 305));
                        }
                    } else {
                        resolve(sleep(10));
                    }

                });
                await Promise.all([waiting, send]);

                // if (typeof command !== 'string') {
                //     try {
                //         const r = await command.function();
                //         //await sleep(1000);
                //     } catch (err) {
                //         logError(ErrorType.EXECUTE, "executeCommand", err);
                //         throw new CustomError('In the execute function, a function linked to a command could not be executed. Error: ' + getErrorMessage(err, true), errorType.fileUpload, 305);
                //     }
                // } else {
                //     await sleep(10);
                // }
            }
            if (memmoryOverflow) {
                throw new CustomError('File was too large for the available memory.', errorType.memmory, 314);
            }
            if (message) {
                this.analyser.messageToOuputChannel(message);
            }
            if (enterLast) { this.analyser.setUserMessages(true); }
            if (enterLast || raw) {//Befehle ausführen.
                await this.write(Buffer.from([0x04]));
                if (enterLast) {
                    this.analyser.setFilter();
                    this.analyser.setFilterOff();
                }
                await sleep(10);
            }
            if (raw) {
                await Promise.all([
                    this.analyser.waitForPattern(
                        /^Type/,
                        1000,
                        'timeoutAfterRaw'
                    ),
                    this.write(Buffer.from([0x02]))
                ]);
            }
            return;
        } catch (err: any) {
            logError(ErrorType.EXECUTE, "execute", err);
            throw (forwardError(err, getErrorMessage(err, false), errorType.fileUpload, 306));
        }
        finally {
            responses?.dispose();
        }
    }

    //Funktion geht davon aus, dass der Port geöffnet ist, ansonsten wird ein Error geworfen
    private async raw_on(): Promise<void> {
        const rawReplMsg = 'raw REPL; CTRL-B to exit';
        return new Promise(async (resolve, reject) => {
            let responses = undefined;
            try {
                const port = await this.connectToMicrobit();
                responses = new SerialResponses(port);
                // 1. Programm unterbrechen und normalen REPL bestätigen.
                await this.exchange(port, responses, '>>>', [0x03, 0x03, 0x03]);

                // //Send CTRL-C three times between pauses to break out of loop.
                // for (let i = 0; i < 3; i++) {
                //     // await this.port.write(Buffer.from('\r\x03', 'utf-8'));
                //     port.write(Buffer.from([0x03]));
                //     await sleep(10);
                // }
                await this.exchange(port, responses, rawReplMsg, [0x01]);
                await this.exchange(port, responses, '>OK', [0x04]);

                // await port.write(Buffer.from('\r\x01', 'utf-8'));
                // await sleep(10);
                // await port.write(Buffer.from([0x04]));
                // await sleep(10);
                resolve();
            } catch (err: any) {
                reject(forwardError(err, getErrorMessage(err, false), errorType.rawOn, 307));
            }
            finally {
                responses?.dispose();
            }
        });
    }

    async prepareMicrobitToWriteFile(target: string) {
        const commands = [
            //'import os',
            'import gc',
            'gc.collect()',
            //`try:os.remove("${target}")`,
            //'except:None',
            //'gc.collect()'
        ];
        return new Promise<void>(async (resolve, reject) => {
            try {
                await this.execute(commands, false, true);
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Löscht die Files auf dem micro:bit
     * @param exclude File, das vom Löschen ausgeschlossen werden soll
     */
    async deleteFiles(exclude: string[]) {
        let list = '[';
        for (let i = 0; i < exclude.length; i++) {
            list = `${list}"${exclude[i]}"`;
            if (i < exclude.length - 1) {
                list = `${list},`;
            }
        }
        list = `${list}]`;
        const commands = [
            'import os',
            'l=os.listdir()',
            'for f in l:',
            `    if not(f in ${list}):`,
            '        os.remove(f)',
        ];
        await this.execute(commands, false, true);
    }

    async deleteAllFiles() {
        const commands = [
            'import os',
            'l=os.listdir()',
            'for f in l:',
            '    os.remove(f)',
        ];
        await this.execute(commands, false, true);
    }

    async machineReset() {
        const commands = [
            'import machine',
            'machine.reset()'
        ];
        await this.execute(commands, false, true);
    }

    /**
     * Vergleicht crc32 Prüfsumme mit sollwert
     * @param exclude File, das vom Löschen ausgeschlossen werden soll
     */
    async crc32Check(pathToFile: string, target: string) {
        const d = await vscode.workspace.fs.readFile(vscode.Uri.file(pathToFile));
        let commands = [
            'def c(data, crc_soll, target):',
            ' crc = 0xFFFFFFFF',
            ' for byte in data:',
            '  crc ^= byte',
            '  for _ in range(8):',
            '   if crc & 1:',
            '    crc = (crc >> 1) ^ 0xEDB88320',
            '   else:',
            '    crc >>= 1',
            ' if crc_soll == hex(crc ^ 0xFFFFFFFF):',
            '  print("crc32"+target+"T")',
            ' else:',
            '  print("crc32"+target+"F")',
        ];
        await this.execute(commands, false, true);
        commands = [
            `d=open('${target}','rb')`,
            'i=d.read()',
            `c(i,'${'0x' + crc32(d)}','${target}')`
        ];
        await this.execute(commands, false, false);

    }



    /**
     * Löscht die Files auf dem micro:bit
     * @param exclude File, das vom Löschen ausgeschlossen werden soll
     */
    async deleteFile(file: string) {
        const commands = [
            'import os',
            `os.remove(${file})`,
        ];
        await this.execute(commands, false, true);
    }

    public addMutationListener(listener: MutationListener) {
        this.mutationListener.push(listener);
    }

    private refreshListener(input: ListenerInput) {
        this.mutationListener.forEach(l => l.refresh(input));
    }

    private async fileUpload(file: any) {
        try {
            let softReboot = false;
            const p = vscode.Uri.file(file.path).fsPath;
            if (!p) { throw new Exception('file.path in the uploadFile command does not exist.', 309); }

            let fileName = file.label;
            try {
                const root = getRootPath(this.context);
                if (p.startsWith(path.join(root, 'src', 'main') + path.sep)) {//main-File
                    fileName = 'main.py';
                    softReboot = true;
                }
            } catch (err) {
                //no root
            }

            await this.connectToMicrobit();
            this.analyser.setUserMessages(false);
            await this.put(p, fileName, softReboot);
        } catch (err: any) {
            if (err?.type !== undefined) {
                throw err;
            }
            throw new CustomError(getErrorMessage(err, false), errorType.fileUpload, 310);
        }
    }
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function ejectDevice(succeeded: Function, noSelection: Function) {
    const platform = process.platform;
    return new Promise<void>((resolve, reject) => {
        // Befehl für Mac OS
        if (platform === 'darwin') {
            const eject = (drive: string) => {
                return new Promise<void>((resolve, reject) => {
                    exec(`diskutil eject /Volumes/${drive.replace(/ /, '\\ ')}`, (error, stdout, stderr) => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        if (stderr) {
                            reject(stderr);
                            return;
                        }
                        resolve();
                    });
                });
            };
            exec('diskutil list external physical', async (error, stdout, stderr) => {
                if (error) {
                    reject(new Exception(`Error when retrieving the volumes: ${stderr}`, 317));
                } else {
                    const drives = stdout.split('\n').filter(drive => drive.match(/[0.9]:/)).map(d => d.split(/  +/g)[2]);
                    const mdrives = drives.filter(drive => drive.match(/^MICROBIT( [0-9])?$/) !== null).map(drive => path.join('/Volumes', drive));
                    if (mdrives.length === 0) {
                        const driveOptions = drives.map(d => ({
                            label: d
                        }));
                        const selectedDrive = await vscode.window.showQuickPick(driveOptions, {
                            placeHolder: l10n.t('Select a Micro:bit drive.')
                        });
                        if (selectedDrive) {
                            try {
                                await eject(selectedDrive.label);
                                succeeded();
                                resolve();
                                return;
                            } catch {
                                reject(new CustomError('An error occurred when ejecting the Micro:bit.', errorType.ejectMicrobit, 323));
                                return;
                            }
                        }
                        noSelection();
                        resolve();
                    } else {
                        try {
                            for (const d in mdrives) {
                                await eject(d);
                            }
                            succeeded();
                            resolve();
                            return;
                        } catch {
                            reject(new CustomError('No micro:bit was found.', errorType.noMicrobit, 311));
                            return;
                        }
                    }
                }
            });
        } else {
            reject(new CustomError('Unsupported platfomr', errorType.platForm, 323));
        }
    });
}

// // Befehl für Windows
// else if (platform === 'win32') {
//     const deviceName = '';
//     exec(`powershell "Remove-Drive -Name '${deviceName}' -Force"`, (error, stdout, stderr) => {
//         if (error) {
//             vscode.window.showErrorMessage(`Error: ${error.message}`);
//             return;
//         }
//         if (stderr) {
//             vscode.window.showErrorMessage(`Stderr: ${stderr}`);
//             return;
//         }
//         vscode.window.showInformationMessage(`Stdout: ${stdout}`);;
//     });
// }

// else {
//     vscode.window.showErrorMessage('Unsupported platform');
// }
// });



function crc32(fileData: Uint8Array) {
    const data = Buffer.from(fileData);
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        let byte = data[i];
        crc ^= byte;
        for (let j = 0; j < 8; j++) {
            if ((crc & 1) !== 0) {
                crc = (crc >>> 1) ^ 0xEDB88320;
            } else {
                crc >>>= 1;
            }
        }
    }
    return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16);
}