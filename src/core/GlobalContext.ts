import { GeneratedChord, SectionMetadata, StyleConfig, SingerPersonaConfig } from './generation/types';
import { MoodId } from './generation/config/MoodFlags';

const EPSILON = 1e-6;

class GlobalContextManager {
    public currentStyle: StyleConfig | null = null;
    public currentBPM: number = 120;
    public currentTimeSignature:[number, number] =[4, 4];
    public currentTonality: string = 'Major'; 
    public currentKeyOffset: number = 0;      
    public globalAbsoluteBeat: number = 0;    
    public currentSingerPersona: SingerPersonaConfig | null = null;
    public currentMoodId?: MoodId;
    
    private currentGrooveDNA: number[] =[];   
    private activeSection: SectionMetadata | null = null;
    private activeChord: GeneratedChord | null = null;

    public initializeNewEra(style: StyleConfig, bpm: number, keyOffset: number, tonality: string, timeSignature: [number, number], moodId?: MoodId) {
        this.currentStyle = style;
        this.currentBPM = bpm;
        this.currentKeyOffset = keyOffset;
        this.currentTonality = tonality;
        this.currentTimeSignature = timeSignature;
        this.currentMoodId = moodId;
    }

    public updateCurrentSlice(section: SectionMetadata, chord: GeneratedChord, grooveDNA: number[]) {
        this.activeSection = section;
        this.activeChord = chord;
        this.currentGrooveDNA = grooveDNA;
    }

    public isGrooveHit(absoluteBeat: number): boolean {
        if (!this.currentGrooveDNA || this.currentGrooveDNA.length === 0) {
            return Math.abs(absoluteBeat - Math.round(absoluteBeat)) < EPSILON;
        }
        const beatsPerBar = this.currentTimeSignature[0];
        const loopLength = 2 * beatsPerBar;
        const localBeat = absoluteBeat % loopLength;
        return this.currentGrooveDNA.some(hit => Math.abs(hit - localBeat) < 0.05);
    }

    /**
     * @deprecated Use style.rhythm.grooveTemplate or isGrooveHit instead.
     */
    public isLayeringHit(absoluteBeat: number): boolean {
        if (!this.currentGrooveDNA || this.currentGrooveDNA.length === 0) {
            return Math.abs(absoluteBeat - Math.round(absoluteBeat)) < EPSILON;
        }
        const beatsPerBar = this.currentTimeSignature[0];
        const loopLength = 2 * beatsPerBar;
        const localBeat = absoluteBeat % loopLength;
        // 叠加点：GrooveDNA 中的正拍 (0, 1, 2, 3...)
        return this.currentGrooveDNA.some(hit => Math.abs(hit - localBeat) < 0.05 && Math.abs(hit - Math.round(hit)) < EPSILON);
    }

    /**
     * @deprecated Use style.rhythm.grooveTemplate or isGrooveHit instead.
     */
    public isInterleavingHit(absoluteBeat: number): boolean {
        if (!this.currentGrooveDNA || this.currentGrooveDNA.length === 0) return false;
        const beatsPerBar = this.currentTimeSignature[0];
        const loopLength = 2 * beatsPerBar;
        const localBeat = absoluteBeat % loopLength;
        // 穿插点：GrooveDNA 中的反拍或切分音
        return this.currentGrooveDNA.some(hit => Math.abs(hit - localBeat) < 0.05 && Math.abs(hit - Math.round(hit)) >= EPSILON);
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