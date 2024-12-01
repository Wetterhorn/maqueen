import { TreeItem, TreeItemCollapsibleState, TreeItemLabel } from 'vscode';

export class AnimatedItem extends TreeItem {
    private origLabel:string|TreeItemLabel;
    private intervalId: NodeJS.Timeout | undefined;
    private animationString: string = '';
    constructor(label: string | TreeItemLabel, collapsibleState?: TreeItemCollapsibleState){
        super(label, collapsibleState);
        this.origLabel = label;
    }
    showAnimation(on:boolean, refresh: Function){
        if(on&&!this.intervalId){
            this.animationString = '';
            const animate = () => {
                if(this.animationString.length < 4){
                    this.animationString += '☕';
                } else {
                    this.animationString = '☕☕☕';
                }
                if(typeof this.label === 'string'){
                    this.label = `${this.origLabel} ${this.animationString}`;
                } else if(this.origLabel && typeof this.origLabel === 'object' && 'label' in this.origLabel) {
                    this.label!.label = `${this.origLabel!.label} ${this.animationString}`;
                }
                refresh();
            };
            animate();
            refresh();
            this.intervalId = setInterval(animate, 500);
        } else {
            if(this.intervalId){
                clearInterval(this.intervalId);
                this.intervalId = undefined;
            }
            this.label = this.origLabel;
        } 
    }
}