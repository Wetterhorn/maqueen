import { registerCommands, Commands, revealAction } from './registerCommand';
import { CommandInput } from '../types';

const commands: Commands = [
    {//Macht externe Bibliothek verfügbar
        id: 'maqueen.enableLib',
        action: (input: CommandInput)=>revealAction(input, 'enableLib')
    },
    {//Stoppt die Verfügbarkeit der externen Bibliothek
        id: 'maqueen.disableLib',
        action: (input: CommandInput)=>revealAction(input, 'disableLib')
    },
    {//Fügt ein externes Modul ab einer lokalen Datei hinzu.
        id: 'maqueen.addExtLibFile',
        action: (input: CommandInput)=>revealAction(input, 'addExtLibFile')
    },
    {//Fügt ein externes Modul ab einem Git-Repository hinzu.
        id: 'maqueen.loadExtLibFile',
        action: (input: CommandInput)=>revealAction(input, 'loadExtLibFile')
    },
    {//Löscht ExtLibFile von Extension
        id: 'maqueen.deleteExtLib',
        action: (input: CommandInput)=>revealAction(input, 'deleteExtLib')
    },
    {//Löscht ExtLibFile von Projekt
        id: 'maqueen.removeExtLib',
        action: (input: CommandInput)=>revealAction(input, 'removeExtLib')
    },
    {//Kopiert ExtLibFile zum Projekt
        id: 'maqueen.copyExtLibFileToWorkspace',
        action: (input: CommandInput)=>revealAction(input, 'copyExtLibFileToWorkspace')
    },
    {//Erneuert ein ExtLibFile im Workspace
        id: 'maqueen.refreshExtLibFileToWorkspace',
        action: (input: CommandInput)=>revealAction(input, 'refreshExtLibFileToWorkspace')
    }
];

export function registerExtLibFileCommands(commandInput: CommandInput){
    registerCommands(commandInput, commands);
}