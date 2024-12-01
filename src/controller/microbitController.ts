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
                if (finalAction) {
                    finalAction();
                }
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
                        await this.connectToMicrobit();
                        this.port!.write(Buffer.from([0x03]));
                        this.port!.write(Buffer.from([0x03]));
                        this.port!.write(Buffer.from([0x04]));
                    }
                );
            case 'stop':
                return async () => {
                    try {
                        if (this.lock) {
                            return;
                        }
                        this.lock = true;
                        //this.analyser.clear();
                        await this.connectToMicrobit();
                        this.port!.write(Buffer.from([0x03]));
                        this.port!.write(Buffer.from([0x03]));
                    } catch (err: any) {
                        await error2user(err);
                    } finally {
                        this.lock = false;
                    }
                };
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
                        this.analyser.clear();
                        this.analyser.setOn(false);
                        await this.connectToMicrobit();
                        this.port!.write(Buffer.from([0x02]));
                        await sleep(50);
                        this.port!.write(Buffer.from([0x03]));
                        await sleep(50);
                        vscode.commands.executeCommand('setContext', 'maqueen.fileUploadRunning', true);
                        await this.checkMicroPython();
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
                        this.port!.write(Buffer.from([0x01]));
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
                        this.port!.write(Buffer.from([0x02]));
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
                        this.port!.write(Buffer.from([0x03]));
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
                        this.port!.write(Buffer.from([0x04]));
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
                        this.port!.write(Buffer.from([0x04]));
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
                        if (typeof c === 'string') { this.execute([c], false, false); }
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
            const port = portList.filter(p => p.vendorId?.toLowerCase() === '0d28');
            if (port.length === 1) {
                resolve(port[0].path);
            } else if (port.length > 1) {
                reject(new CustomError("More than one microbit was detected.", errorType.moreThanOneMicrobit, 302));
            } else {
                reject(new CustomError("No microbit was recognised.", errorType.noMicrobit, 303));
            }
        });
        return p;
    }

    private openPort() {
        return new Promise<void>((resolve, reject) => {
            this.port?.open((err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
    /**
     * Versucht einen Port zu öffnen. Erstellt nur einen neuen Port, wenn noch keiner geöffnet ist.
     */
    private open = () => {
        return new Promise<SerialPort>(async (resolve, reject) => {
            if (this.port) {
                if (this.port.isOpen) {
                    resolve(this.port);
                    return;
                } else {
                    try {
                        await this.openPort();
                        if (!this.port.isOpen) {
                            throw new Error();
                        }
                        resolve(this.port);
                    } catch (err: any) {
                        reject(new CustomError(`The port ${this.port.path} could not be opened.`, errorType.noPort, 301));
                    } finally {
                        return;
                    }
                }
            } else {
                let portPath = '';
                try {
                    portPath = await this.lookForMicrobit();
                } catch (err: any) {
                    reject(err);
                    return;
                }
                try {
                    const p = new SerialPort({ path: portPath, baudRate: this.BAUD_RATE, autoOpen: true });
                    this.port = p;
                    this.parserRegistered = false;
                    resolve(p);
                } catch (err: any) {
                    reject(new CustomError('No serial port could be opened.', errorType.noPort, 315));
                } finally {
                    return;
                }
            }
        });
    };

    private async close() {
        const port = await this.open();
        try {
            port.close();
        } catch (err: any) {
            throw new CustomError('Port could not be closed.', errorType.portClose, 313);
        }
    }

    private connectToMicrobit(): Promise<SerialPort> {
        return new Promise(async (resolve, reject) => {
            try {
                const r = await this.open();
                if (!this.parserRegistered) {
                    const parser = r.pipe(new ReadlineParser({ delimiter: '\r\n' }));
                    parser.on('data', d => this.analyser.dataHandler(d));
                    this.parserRegistered = true;
                }
                resolve(r);
            } catch (err: any) {
                reject(forwardError(err, err.message, errorType.noPort, 316));
            }
        });
    }
    async checkMicroPython() {
        try {
            const r = await this.execute([{ command: 'print("hello")', function: async () => await this.analyser.waitForPatern(/hello$/, 1000, 'timeOut') }], false, false);
        } catch (err: any) {
            throw new CustomError('The Micro:bit does not react as desired. Press the reset button on Micro:bit.', errorType.pressResetButton, 320);
        }
    }


    //Sendet ein File (filePath) und lädt es unter dem Namen target auf den micro:bit
    async put(filePath: string, target: string, softReboot: boolean = false): Promise<void> {
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
                const fileUri = vscode.Uri.file(filePath);
                let data = (await vscode.workspace.fs.readFile(fileUri)).toString();

                commands = [
                    { command: `import gc`, function: () => { sleep(5); } },
                    { command: `fd = open("${target}", "wb")`, function: () => { sleep(5); } },
                    { command: 'f = fd.write', function: () => { sleep(5); } },
                    // {
                    //     command: "f(\"tsbewegung\\r\\n    - fährt solange vorwärts, bis ein ande\")",
                    //     function: async () => await this.analyser.waitForPatern(/^[1-9][0-9]/, 5000, 'timeOut'),
                    //   }
                ];
                data = data.replace(/#.*/gm, '');
                //data = data.replace(/ä/, '\\xc3\\xa4').replace(/ö/, '\\xc3\\xb6').replace(/ü/, '\\xc3\\xbc').replace(/Ä/, '\\xc3\\x84').replace(/Ö/, '\\xc3\\x96').replace(/Ü/, '\\xc3\\x9C');
                const bd = Buffer.from(data);
                for (let i = 0; i < data.length; i = i + 54) {
                    //commands.push({ command: 'f(b' + JSON.stringify(data.substring(i, i + 54)) + ')', function: async () => await this.analyser.waitForPatern(/^[1-9][0-9]/, 5000, 'timeOut') });
                    commands.push({ command: 'f(b' + JSON.stringify(bd.subarray(i, i + 54).toString().replace(/ä/g, '\\xc3\\xa4').replace(/ö/g, '\\xc3\\xb6').replace(/ü/g, '\\xc3\\xbc').replace(/Ä/g, '\\xc3\\x84').replace(/Ö/g, '\\xc3\\x96').replace(/Ü/g, '\\xc3\\x9C')) + ')', function: async () => await this.analyser.waitForPatern(/^[1-9][0-9]*/, 5000, 'timeOut') });
                    if (i % 10 === 0) {
                        commands.push({ command: 'print("s",gc.mem_free())', function: async () => await this.analyser.waitForPatern(/^s [0-9]+/, 5000, 'timeOut') });
                    }
                }
                commands.push({ command: "fd.close()", function: async () => await this.analyser.waitForPatern(/^>>> fd.close\(\)$/, 5000, 'timeOut') });

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
        return new Promise(async (resolve, reject) => {
            try {
                const p = await this.open();
                p.write(Buffer.from([0x03]));
                if (raw) {
                    await this.raw_on();
                }
                let memmoryOverflow = false;
                for (let command of commands) {
                    const com = typeof command === 'string' ? command + '\r' : command.command + '\r';
                    const commandBuffer = Buffer.from(com, 'utf-8');
                    let count = 0;
                    (await this.open()).write(commandBuffer, (err) => {
                        if (err) {
                            console.log('Fehler beim Schreiben: ', err.message);
                        }
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
                    if (typeof command !== 'string') {
                        try {
                            const r = await command.function();
                            //await sleep(1000);
                        } catch (err) {
                            throw new CustomError('In the execute function, a function linked to a command could not be executed. Error: ' + getErrorMessage(err, true), errorType.fileUpload, 305);
                        }
                    } else {
                        await sleep(10);
                    }
                }
                if (memmoryOverflow) {
                    throw new CustomError('File was too large for the available memory.', errorType.memmory, 314);
                }
                if (message) {
                    this.analyser.messageToOuputChannel(message);
                }
                if (enterLast) { this.analyser.setUserMessages(true); }
                if (enterLast || raw) {//Befehle ausführen.
                    (await this.open()).write(Buffer.from([0x04]));
                    if (enterLast) {
                        this.analyser.setFilter();
                        this.analyser.setFilterOff();
                    }
                    await sleep(10);
                }
                if (raw) {//raw mode verlassen
                    (await this.open()).write(Buffer.from([0x02]));
                    await this.analyser.waitForPatern(/^Type/, 1000, 'timeout');
                }
                resolve();
            } catch (err: any) {
                reject(forwardError(err, getErrorMessage(err, false), errorType.fileUpload, 306));
            }
        });
    }

    //Funktion geht davon aus, dass der Port geöffnet ist, ansonsten wird ein Error geworfen
    private async raw_on(): Promise<void> {
        const rawReplMsg = 'raw REPL; CTRL-B to exit\r\n>';
        return new Promise(async (resolve, reject) => {
            try {
                const port = await this.open();
                //Send CTRL-C three times between pauses to break out of loop.
                for (let i = 0; i < 3; i++) {
                    // await this.port.write(Buffer.from('\r\x03', 'utf-8'));
                    port.write(Buffer.from([0x03]));
                    await sleep(10);
                }
                await port.write(Buffer.from('\r\x01', 'utf-8'));
                await sleep(10);
                await port.write(Buffer.from([0x04]));
                await sleep(10);
                resolve();
            } catch (err: any) {
                reject(forwardError(err, getErrorMessage(err, false), errorType.rawOn, 307));
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
            try{
                const root = getRootPath(this.context);
                if (p.startsWith(path.join(root, 'src', 'main') + path.sep)) {//main-File
                    fileName = 'main.py';
                    softReboot = true;
                }
            } catch(err){
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