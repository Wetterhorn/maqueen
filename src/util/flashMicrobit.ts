import * as vscode from 'vscode';
import path from 'path';
import { exec } from 'child_process';
import os from 'os';
import { CustomError, errorType, Exception, forwardError, getErrorMessage } from '../exception';
import { l10n } from 'vscode';


function getMicrobitDrives() {
    return new Promise<string[]>(async (resolve, reject) => {
        const platform = os.platform();
        if (os.platform() === 'darwin') {
            // macOS - Volumes werden in /Volumes gemountet
            exec('diskutil list external physical', async (error, stdout, stderr) => {
                if (error) {
                    reject(new Exception(`Error when retrieving the volumes: ${stderr}`, 317));
                } else {
                    const drives = stdout.split('\n').filter(drive => drive.match(/[0.9]:/)).map(d => d.split(/  +/g)[2]);
                    const mdrives = drives.filter(drive => drive.match(/^MICROBIT( [0-9])?$/) !== null).map(drive => path.join('/Volumes', drive));
                    if (mdrives.length === 0&&drives.length !== 0) {
                        const driveOptions = drives.map(d => ({
                            label: d
                        }));
                        const selectedDrive = await vscode.window.showQuickPick(driveOptions, {
                            placeHolder: l10n.t('Select a Micro:bit drive.')
                        });
                        if (selectedDrive) {
                            resolve([path.join('/Volumes', selectedDrive.label)]);
                            return;
                        }
                        reject(new CustomError('No micro:bit was found.', errorType.noMicrobit, 311));
                    } else {
                        resolve(drives);
                    }
                }
            });
        } else if (os.platform() === 'win32') {
            // Windows - Laufwerksbuchstaben abrufen
            exec('wmic logicaldisk get VolumeName,name', (error, stdout, stderr) => {
                if (error) {
                    reject(new Exception(`Error when retrieving the volumes: ${stderr}`, 318));
                } else {
                    const drives = stdout.split('\r\n').filter(line => line.includes(':'));
                    const mdrives = drives.filter(drive => drive.match(/MICROBIT/) !== null);
                    if (!mdrives || mdrives.length === 0) {
                        reject(new CustomError('No micro:bit was found.', errorType.noMicrobit, 311));
                    } else {
                        const r: string[] = [];
                        for (let i = 0; i < mdrives.length; i++) {
                            const m = mdrives[i].match(/[A-Z]:/);
                            if (m) {
                                r.push(m[0]);
                            }
                        }
                        resolve(r);
                    }
                }
            });
        } else if (platform === "linux") {
            exec('df', async (error, stdout, stderr) => {
                if (error) {
                    reject(new Exception(`Error when retrieving the volumes: ${stderr}`, 317));
                } else {
                    const drives = stdout.split('\n').filter(drive => drive.match(/\/media\/.*\/MICROBIT/)).map(d => d.split(/ +/g)[5]);;
                    if (!drives || drives.length === 0) {
                        reject(new CustomError('No micro:bit was found.', errorType.noMicrobit, 311));
                    } else {
                        resolve(drives);
                    }
                }
            });
        }
        else {
            reject(new CustomError('Unsupported operating system', errorType.platForm, 400));
            //callback([]);
        }
    });
}
export async function flashMicrobit(extensionPath: string, send: Function) {
    const sourceFilePath = path.join(extensionPath, 'micropython.hex');
    try {
        const microbitDrives = await getMicrobitDrives();
        const data = await vscode.workspace.fs.readFile(vscode.Uri.file(sourceFilePath));
        for (let i = 0; i < microbitDrives.length; i++) {
            const targetFilePath = path.join(microbitDrives[i], 'MICROBIT.hex');
            writeFileToMicrobit(data, vscode.Uri.file(targetFilePath), send);
            //vscode.workspace.fs.copy(vscode.Uri.file(sourceFilePath), vscode.Uri.file(targetFilePath));
        }
    } catch (err: any) {
        throw forwardError(err, getErrorMessage(err), errorType.flash, 322);
    }
}
async function writeFileToMicrobit(data: Uint8Array, targetUri: vscode.Uri, send: Function) {
    try {
        send(l10n.t({ message: 'Flash MicroPython to {0}. Please wait...', args: [targetUri.fsPath], comment: ['{0}: Path to Micro:bit'] }));
        await vscode.workspace.fs.writeFile(targetUri, data);
        send(l10n.t({ message: '{0} has been flashed.', args: [targetUri.fsPath], comment: ['{0}: Path to Micro:bit'] }));
    } catch (err: any) {
        new Exception(getErrorMessage(err), 319);
        vscode.window.showErrorMessage(l10n.t({ message: 'The following error occurred when flashing {0}: {1}', args: [targetUri.fsPath, err.message], comment: ['{0}: Path to Micro:bit', '{1}: Fehlermeldung'] }));
    }
}

export async function copyFileToMicrobit(extensionPath: string) {
    await getMicrobitDrives();
}