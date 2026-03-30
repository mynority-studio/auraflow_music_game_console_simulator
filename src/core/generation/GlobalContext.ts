import { GeneratedChord, SectionMetadata, StyleConfig, SingerPersonaConfig } from './types';

class GlobalContextManager {
    public currentStyle: StyleConfig | null = null;
    public currentBPM: number = 120;
    public currentTimeSignature:[number, number] =[4, 4];
    public currentTonality: string = 'Major'; 
    public currentKeyOffset: number = 0;      
    public globalAbsoluteBeat: number = 0;    
    public currentSingerPersona: SingerPersonaConfig | null = null;
    
    private currentGrooveDNA: number[] =[];   
    private activeSection: SectionMetadata | null = null;
    private activeChord: GeneratedChord | null = null;

    public initializeNewEra(style: StyleConfig, bpm: number, keyOffset: number, tonality: string, timeSignature: [number, number]) {
        this.currentStyle = style;
        this.currentBPM = bpm;
        this.currentKeyOffset = keyOffset;
        this.currentTonality = tonality;
        this.currentTimeSignature = timeSignature;
        // console.log(`[GlobalContext] 🪐 宇宙法则已重写: ${style.name} | BPM: ${bpm} | Key: ${keyOffset} | TimeSig: ${timeSignature[0]}/${timeSignature[1]}`);
    }

    public updateCurrentSlice(section: SectionMetadata, chord: GeneratedChord, grooveDNA: number[]) {
        this.activeSection = section;
        this.activeChord = chord;
        this.currentGrooveDNA = grooveDNA;
    }

    public isGrooveHit(absoluteBeat: number): boolean {
        if (!this.currentGrooveDNA || this.currentGrooveDNA.length === 0) return absoluteBeat % 1 === 0;
        const beatsPerBar = this.currentTimeSignature[0];
        const loopLength = 2 * beatsPerBar; 
        const localBeat = absoluteBeat % loopLength;
        return this.currentGrooveDNA.some(hit => Math.abs(hit - localBeat) < 0.05);
    }

    public getCurrentEnergyLevel(): number { return this.activeSection ? this.activeSection.energyLevel : 5; }
    public getCurrentChord(): GeneratedChord | null { return this.activeChord; }
    public getActiveSection(): SectionMetadata | null { return this.activeSection; }

    public reset() {
        this.currentStyle = null;
        this.currentBPM = 120;
        this.currentTimeSignature = [4, 4];
        this.currentTonality = 'Major';
        this.currentKeyOffset = 0;
        this.globalAbsoluteBeat = 0;
        this.currentSingerPersona = null;
        this.currentGrooveDNA = [];
        this.activeSection = null;
        this.activeChord = null;
    }
}

export const GlobalContext = new GlobalContextManager();