import { ListenerInput } from "../types";

export interface ActionHolder {
    getAction: (actionId:string) => ((...args: any[]) => any)
}

export interface MutationListener {
    refresh: (input: ListenerInput | void) => void,
    readonly parentDirectory?: string | undefined
}