import { NoteData } from '@/src/core/generation/types';

interface RecordingEvent {
    padIndex: number;
    midiNote: number;
    velocity: number;
    onsetMs: number;
    releaseMs: number;
}

export class MotifRecorder {
    private events: RecordingEvent[] = [];
    private openNotes: RecordingEvent[] = []; // P-1: 用数组代替 Map
    private startTime: number = 0;
    private assumedBpm: number = 120;

    start(): void {
        this.events = [];
        this.openNotes = [];
        this.startTime = performance.now();
    }

    noteOn(padIndex: number, midiNote: number, velocity: number): void {
        const event: RecordingEvent = {
            padIndex,
            midiNote,
            velocity,
            onsetMs: performance.now() - this.startTime,
            releaseMs: 0
        };
        this.openNotes.push(event);
        this.events.push(event);
    }

    noteOff(padIndex: number): void {
        const now = performance.now() - this.startTime;
        for (let i = this.openNotes.length - 1; i >= 0; i--) {
            if (this.openNotes[i].padIndex === padIndex) {
                this.openNotes[i].releaseMs = now;
                this.openNotes.splice(i, 1);
                break;
            }
        }
    }

    /** 停止录制，关闭所有未结束的音符，返回 NoteData[] */
    stop(): NoteData[] {
        const now = performance.now() - this.startTime;
        for (let i = 0; i < this.openNotes.length; i++) {
            this.openNotes[i].releaseMs = now;
        }
        this.openNotes = [];
        return this.toNoteData();
    }

    getEventCount(): number {
        return this.events.length;
    }

    getElapsedMs(): number {
        if (this.startTime === 0) return 0;
        return performance.now() - this.startTime;
    }

    private toNoteData(): NoteData[] {
        const msPerBeat = 60000 / this.assumedBpm;
        const result: NoteData[] = [];
        for (let i = 0; i < this.events.length; i++) {
            const e = this.events[i];
            result.push({
                pitch: e.midiNote,
                onset: e.onsetMs / msPerBeat,
                duration: Math.max(0.125, (e.releaseMs - e.onsetMs) / msPerBeat),
                velocity: e.velocity / 127,
                isUserMotif: true
            });
        }
        return result;
    }
}
