import { registerCommands, Commands, revealAction } from './registerCommand';
import { CommandInput } from '../types';

const commands: Commands = [
    {//Lädt File auf Micro:bit
        id: 'maqueen.uploadFile',
        action: (input: CommandInput)=>revealAction(input, 'uploadFile')
    },
    {//Stopt Programm auf Micro:bit
        id: 'maqueen.stop',
        action: (input: CommandInput)=>revealAction(input, 'stop')
    },
    {//Erzeugt Softreboot auf Micro:bit
        id: 'maqueen.softreboot',
        action: (input: CommandInput)=>revealAction(input, 'softreboot')
    },
    {//Schliesst den port auf Micro:bit
        id: 'maqueen.closePort',
        action: (input: CommandInput)=>revealAction(input, 'closePort')
    },
    {//Reset des Microbits zur Verwendung für Maqueen Roboter
        id: 'maqueen.flashMicrobit',
        action: (input: CommandInput)=>revealAction(input, 'flash')
    },
    {//Sende Ctrl-A
        id: 'maqueen.ctrla',
        action: (input: CommandInput)=>revealAction(input, 'ctrla')
    },
    {//Sende Ctrl-B
        id: 'maqueen.ctrlb',
        action: (input: CommandInput)=>revealAction(input, 'ctrlb')
    },
    {//Sende Ctrl-C
        id: 'maqueen.ctrlc',
        action: (input: CommandInput)=>revealAction(input, 'ctrlc')
    },
    {//Sende Ctrl-D
        id: 'maqueen.ctrld',
        action: (input: CommandInput)=>revealAction(input, 'ctrld')
    },
    {//Sende Ctrl-E
        id: 'maqueen.ctrle',
        action: (input: CommandInput)=>revealAction(input, 'ctrle')
    },
    {//Sendet ein Kommando an den Microbit
        id: 'maqueen.sendCommandToMicrobit',
        action: (input: CommandInput)=>revealAction(input, 'sendCommandToMicrobit')
    },
    {//Löscht eine Datei auf dem Microbit
        id: 'maqueen.deleteFilesOnMicrobit',
        action: (input: CommandInput)=>revealAction(input, 'deleteFilesOnMicrobit')
    }
    ,
    {//Wirft Micro:bit aus
        id: 'maqueen.ejectDevice',
        action: (input: CommandInput)=>revealAction(input, 'ejectDevice')
    }
];

export function registerMicrobitCommands(commandInput: CommandInput){
    registerCommands(commandInput, commands);
}