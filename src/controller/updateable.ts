export interface Updateable<Data> {
    update: (d:Data) => void;
}