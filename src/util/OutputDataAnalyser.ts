import * as vscode from 'vscode';
import { revealText } from './language';
import { l10n } from 'vscode';

export class OutputDataAnalyser {
    private state = state.on;
    private onPattern = /.*/;
    private offPattern = /.*/;
    private observeState = false;
    private stateChangePromise: Function = () => { };
    private filterList: filterElement[];
    private userInformFilterList: userInformfilterElement[];
    private filterOn = false;
    private onTime = 0;
    private timeOut = 0;
    private inclusive = false;
    private outputChannel;
    private fullFillPromise: Function | null = null;
    private fullFillPromisePattern = /.*/;
    private userMessages = true;
    private observeDataCondition: (data: string) => boolean = () => false;
    private observedDataFlag = false;
    private timeOutId: NodeJS.Timeout | undefined = undefined;
    public constructor() {
        this.filterList = [
            {
                search: /^Traceback/,
                delete: null,
                on: true,
            },
            {
                search: /[a-zA-Z]+Error:/,
                delete: null,
                on: false,
            },
            {
                search: /^[a-zA-Z]+Interrupt:/,
                delete: null,
                on: false,
            },
            {
                search: /^MPY: soft reboot/,
                delete: null,
                on: true,
                replace: ` > ${l10n.t('Program is running...')}`
            },
            {
                search: /^MicroPython v/,
                delete: null,
                on: false,
                replace: ` > ${l10n.t('Program has been terminated.')}`
            },
            {
                search: /^Type "help\(\)" for more information\.$/,
                delete: true,
                on: true
            },
            {
                search: /^>>>/,
                delete: />>> */,
                on: true
            }
        ];
        this.userInformFilterList = [
            {
                search: /^OSError:[ \[a-zA-Z]*28/,
                message: revealText('The error message ‘OSError: 28’ means that the memory of the micro:bit is full.', 'Die Fehlermeldung «OSError: 28» bedeutet, dass der Speicher des Micro:bits voll ist.'),
                isError: true
            },
            // {
            //     search: /Traceback/,
            //     message: revealText('Error in the Python script.', 'Fehler im Pythonskript.'),
            //     isError: false
            // },
            // {
            //     search: /Error/,
            //     message: revealText('Error in Python script', 'Fehler im Pythonskript.'),
            //     isError: true
            // },
        ];
        this.outputChannel = vscode.window.createOutputChannel("MicroPython");
        this.outputChannel.show(true);
    }

    private sendToOutputChannel(data: string) {
        if (this.userMessages) {
            this.outputChannel.appendLine(data);
            this.setVisible(true);
        }
    }

    public messageToOuputChannel = (message: string) => {
        this.outputChannel.appendLine(` > ${message}`);
        this.setVisible(true);
    };

    public clear = () => this.outputChannel.clear();

    public setVisible(on: boolean) {
        on ? this.outputChannel.show(true) : this.outputChannel.hide();
    }

    public setUserMessages(on: boolean) {
        this.userMessages = on;
    }

    public setOffUntilPattern(pattern: RegExp) {
        this.state = state.waitForOnPattern;
        this.onPattern = pattern;
        this.observeState = true;
    }

    public setOnUntilPatern(pattern: RegExp) {
        this.state = state.waitForOffPattern;
        this.offPattern = pattern;
        this.observeState = true;
    }

    public setOffUntilTimeOut(timeOut: number) {
        this.onTime = getCurrentTimeInMicroseconds() + timeOut;
        this.timeOut = timeOut;
        this.state = state.offUntilTimeOut;
        this.observeState = true;
    }

    public setOffUntil(pattern: RegExp, timeOut: number, inclusiv = false) {
        this.state = state.waitForOnPatterOrTimeOut;
        this.onTime = getCurrentTimeInMicroseconds() + timeOut;
        this.timeOut = timeOut;
        this.onPattern = pattern;
        this.inclusive = inclusiv;
        this.observeState = true;
    }

    public setOn(on: boolean) {
        if (on) {
            this.state = state.on;
        } else {
            this.state = state.off;
        }
    }

    public setFilter() {
        this.state = state.filter;
    };

    public setFilterOff() {
        this.filterOn = false;
    }

    public observeData = (condition: (data: string) => boolean) => {
        this.observeDataCondition = condition;
    };

    public getObserveDataFlag = () => {
        if (this.observedDataFlag) {
            this.observedDataFlag = false;

            return true;
        }
        return false;
    };

    public dataHandler = (data: string) => {
        console.log(data);
        if (this.observeDataCondition(data)) {
            this.observedDataFlag = true;
        }
        if (this.userMessages || this.fullFillPromise) {
            for (const e of this.userInformFilterList) {
                if (data.match(e.search)) {
                    if (e.isError && this.fullFillPromise && !data.match(/^>>> f\(b".*"\)$/)) {
                        this.fullFillPromise(null);
                        this.fullFillPromise = null;
                    }
                    if (this.userMessages && e.isError) {
                        vscode.window.showWarningMessage(e.message);
                    }
                }
            }
        }


        //this.outputChannel.appendLine(data);
        if (this.fullFillPromise) {
            const m = data.match(this.fullFillPromisePattern);
            if (m) {
                this.fullFillPromise(data);
                this.fullFillPromise = null;
            }
        }
        switch (this.state) {
            case state.on:
                this.sendToOutputChannel(data);
                break;
            case state.off:
                break;
            case state.waitForOnPattern:
                if (data.match(this.onPattern)) {
                    this.state = state.on;
                    this.sendToOutputChannel(data);
                    if (this.observeState) {
                        this.stateChangePromise(true);
                        this.observeState = false;
                    }
                }
                break;
            case state.waitForOffPattern:
                if (data.match(this.offPattern)) {
                    this.state = state.off;
                    if (this.observeState) {
                        this.stateChangePromise(true);
                        this.observeState = false;
                    }
                }
                break;
            case state.offUntilTimeOut:
                const currentTime = getCurrentTimeInMicroseconds();
                if (currentTime >= this.onTime) {
                    this.state = state.on;
                    this.sendToOutputChannel(data);
                    if (this.observeState) {
                        this.stateChangePromise(true);
                        this.observeState = false;
                    }
                } else {
                    this.onTime = currentTime + this.timeOut;
                }
                break;
            case state.waitForOnPatterOrTimeOut:
                const currentTime2 = getCurrentTimeInMicroseconds();
                if (currentTime2 >= this.onTime || data.match(this.onPattern)) {
                    this.state = state.on;
                    if (this.inclusive) {
                        this.sendToOutputChannel(data);
                    }
                    if (this.observeState) {
                        this.stateChangePromise(true);
                        this.observeState = false;
                    }
                } else {
                    this.onTime = currentTime2 + this.timeOut;
                }
                break;
            case state.filter:
                for (const element of this.filterList) {
                    if (data.match(element.search)) {
                        if (element.delete instanceof RegExp) {
                            data = data.replace(element.delete, '');
                        }
                        this.filterOn = element.on;
                        if (element.delete === true || data === '') {
                            return;
                        }
                        this.sendToOutputChannel(element.replace ? element.replace : data);
                        return;
                    }
                }
                if (this.filterOn) {
                    this.sendToOutputChannel(data);
                }
        }
    };

    /**
    * Gibt ein Promise-Objekt zurück, das erfüllt wird, wenn das gegebene Patern die Daten matched. Die Promise wird zurückgeworfen, wenn das TimeOut eintritt.
    *
    * @param patern Regulärer Ausdruck
    * @param timeOutafter Zeit in Millisekunden. Promise wird zurückgeworfen, wenn nach dieser Zeit das Patern nicht gematched wurde.
    * @param timeOutMessage String, der zurückgegeben wird, wenn Timeout eintritt.
    * @returns Promise, wird sie erfüllt, werden die gelesenen Daten zurückgegeben, anderfalls die timeOutMessage.
    */
    public waitForPattern = (pattern: RegExp, timeOutafter: number, timeOutMessage: string) => {
        // if (this.timeOutId) { 
        //     clearTimeout(this.timeOutId); 
        //     this.timeOutId = undefined;
        // }
        this.fullFillPromisePattern = pattern;
        return new Promise((resolve, reject) => {
            const callback = (data: string | null) => {
                if (data) {
                    resolve(data);
                } else {
                    reject(timeOutMessage);
                }
            };
            this.fullFillPromise = callback;
            this.timeOutId = setTimeout(() => {
                if (this.fullFillPromise !== null) {
                    callback(null);
                }
            }, timeOutafter);
        });
    };

    // public waitForPattern = (pattern: RegExp, timeoutAfter: number, timeoutMessage: string) => {
    //     if (this.timeOutId) {
    //         clearTimeout(this.timeOutId);
    //         this.timeOutId = undefined;
    //     }
    //     this.fullFillPromisePattern = pattern;

    //     return new Promise<string>((resolve, reject) => {
    //         this.fullFillPromise = (data: string) => {
    //             clearTimeout(this.timeOutId!);
    //             resolve(data);
    //         };
    //         this.timeOutId = setTimeout(() => reject(timeoutMessage), timeoutAfter);
    //     });
    // };

    public hasStateChanged() {
        return new Promise((resolve, reject) => {
            const callback = (b: boolean) => {
                if (b) {
                    resolve(b);
                } else {
                    reject();
                }
            };
            if (this.observeState) {
                this.stateChangePromise = callback;
            } else {
                callback(false);
            }
        });
    }
}

enum state {
    on,
    off,
    waitForOnPattern,
    waitForOffPattern,
    offUntilTimeOut,
    waitForOnPatterOrTimeOut,
    filter,
}

function getCurrentTimeInMicroseconds(): number {
    const [seconds, nanoseconds] = process.hrtime();
    return seconds * 1e6 + nanoseconds / 1e3;
}

type filterElement = {
    search: RegExp,
    delete: RegExp | null | boolean,
    on: boolean,
    replace?: string
};

type userInformfilterElement = {
    search: RegExp,
    message: string,
    isError: boolean
};