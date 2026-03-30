import { WorkletSynthesizer } from 'spessasynth_lib';

export interface MidiEvent {
    ticks: number; // Time in ticks (e.g., 480 PPQ)
    type: 'noteOn' | 'noteOff' | 'cc' | 'programChange' | 'visual';
    channel: number;
    data1: number;
    data2: number;
    visualData?: any; // For visual events
}

/**
 * Custom MIDI Scheduler
 * 
 * This scheduler mimics the behavior of a FreeRTOS hardware timer on the ESP32.
 * Instead of relying on Web Audio's sample-accurate look-ahead,
 * it wakes up periodically (e.g., every 5ms) and dispatches MIDI events that are due.
 * 
 * This guarantees that the timing logic and event dispatching in the Web Simulator
 * is architecturally identical to how the C++ firmware will push bytes to the I2S/Synth task.
 */
export class MidiScheduler {
    private synth: WorkletSynthesizer | null = null;
    private events: MidiEvent[] = [];
    private eventIndex: number = 0;
    
    public isPlaying: boolean = false;
    private currentTick: number = 0;
    private lastTimeMs: number = 0;
    
    private bpm: number = 120;
    public readonly ppq: number = 480; // Pulses Per Quarter note (Standard MIDI resolution)
    
    private timerId: number | null = null;
    // Wake up every 5ms (mimics FreeRTOS 5ms tick / vTaskDelay)
    private tickIntervalMs: number = 5; 

    // Looping
    public loop: boolean = false;
    public loopStartTicks: number = 0;
    public loopEndTicks: number = 0;

    // Callbacks
    private visualListeners: ((data: any) => void)[] = [];
    private endListeners: (() => void)[] = [];

    public init(synth: WorkletSynthesizer) {
        this.synth = synth;
    }

    public addVisualListener(listener: (data: any) => void) {
        this.visualListeners.push(listener);
    }

    public removeVisualListener(listener: (data: any) => void) {
        this.visualListeners = this.visualListeners.filter(l => l !== listener);
    }

    public onTrackEnd(listener: () => void) {
        this.endListeners.push(listener);
    }

    /**
     * Loads a sequence of MIDI events and resets the playhead.
     */
    public loadTrack(events: MidiEvent[], bpm: number) {
        // Ensure events are strictly sorted by time
        this.events = events.sort((a, b) => a.ticks - b.ticks);
        this.bpm = bpm;
        this.eventIndex = 0;
        this.currentTick = 0;
    }

    public setBpm(bpm: number) {
        this.bpm = bpm;
    }

    public getBpm(): number {
        return this.bpm;
    }

    public setPosition(ticks: number) {
        this.currentTick = ticks;
        // Find the correct event index
        this.eventIndex = 0;
        while (this.eventIndex < this.events.length && this.events[this.eventIndex].ticks < this.currentTick) {
            this.eventIndex++;
        }
    }

    public getCurrentTick(): number {
        return this.currentTick;
    }

    public start() {
        if (!this.synth || this.isPlaying) return;
        this.isPlaying = true;
        this.lastTimeMs = performance.now();
        this.tickLoop();
    }

    public stop() {
        this.isPlaying = false;
        if (this.timerId !== null) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
        this.currentTick = 0;
        this.eventIndex = 0;
        this.panic();
    }

    public pause() {
        this.isPlaying = false;
        if (this.timerId !== null) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
        // Silence all currently playing notes, but keep the playhead position
        this.panic();
    }

    public clear() {
        this.stop();
        this.events = [];
        this.visualListeners = [];
        this.endListeners = [];
    }

    /**
     * Sends "All Notes Off" and "All Sound Off" to all 16 MIDI channels.
     */
    public panic() {
        if (!this.synth) return;
        for (let i = 0; i < 16; i++) {
            this.synth.controllerChange(i, 123, 0); // All Notes Off
            this.synth.controllerChange(i, 120, 0); // All Sound Off
        }
    }

    /**
     * The core timing loop. Mimics a hardware timer interrupt.
     */
    private tickLoop = () => {
        if (!this.isPlaying) return;

        const now = performance.now();
        const deltaMs = now - this.lastTimeMs;
        this.lastTimeMs = now;

        // Calculate how many ticks passed based on current BPM
        // 1 beat = 60000 / BPM ms
        // 1 tick = (60000 / BPM) / PPQ ms
        const msPerTick = (60000 / this.bpm) / this.ppq;
        const deltaTicks = deltaMs / msPerTick;
        
        this.currentTick += deltaTicks;

        // Check for loop
        if (this.loop && this.loopEndTicks > 0 && this.currentTick >= this.loopEndTicks) {
            this.currentTick = this.loopStartTicks + (this.currentTick - this.loopEndTicks);
            // Reset event index to loop start
            this.eventIndex = 0;
            while (this.eventIndex < this.events.length && this.events[this.eventIndex].ticks < this.currentTick) {
                this.eventIndex++;
            }
        }

        // Process all events that are due (or overdue)
        while (this.eventIndex < this.events.length) {
            const ev = this.events[this.eventIndex];
            if (ev.ticks <= this.currentTick) {
                this.dispatchEvent(ev);
                this.eventIndex++;
            } else {
                // Next event is in the future, break the loop
                break;
            }
        }

        // Schedule next wake-up if there are more events, or if looping
        if (this.eventIndex < this.events.length || this.loop) {
            this.timerId = window.setTimeout(this.tickLoop, this.tickIntervalMs);
        } else {
            this.isPlaying = false; // Track finished
            this.endListeners.forEach(l => l());
        }
    }

    private dispatchEvent(ev: MidiEvent) {
        if (!this.synth) return;
        
        switch (ev.type) {
            case 'noteOn':
                this.synth.noteOn(ev.channel, ev.data1, ev.data2);
                break;
            case 'noteOff':
                this.synth.noteOff(ev.channel, ev.data1);
                break;
            case 'cc':
                this.synth.controllerChange(ev.channel, ev.data1 as any, ev.data2);
                break;
            case 'programChange':
                this.synth.programChange(ev.channel, ev.data1);
                break;
            case 'visual':
                this.visualListeners.forEach(l => l(ev.visualData));
                break;
        }
    }

    /**
     * Helper to convert beats (from ArrangedTrack) to MIDI ticks.
     */
    public beatsToTicks(beats: number): number {
        return Math.round(beats * this.ppq);
    }
}

export const globalMidiScheduler = new MidiScheduler();
