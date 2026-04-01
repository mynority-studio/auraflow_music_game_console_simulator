import { WorkletSynthesizer } from 'spessasynth_lib';
import { TempoCurve } from '../generation/types';

export interface MidiEvent {
    ticks: number; // Time in ticks (e.g., 480 PPQ)
    type: 'noteOn' | 'noteOff' | 'cc' | 'programChange' | 'pitchBend' | 'visual';
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
 * it wakes up periodically and dispatches MIDI events that are due.
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
    
    private baseBpm: number = 120;
    private currentBpm: number = 120;
    public readonly ppq: number = 480; // Pulses Per Quarter note (Standard MIDI resolution)
    
    private timerId: number | null = null;
    private tempoCurves: TempoCurve[] = [];

    // Looping
    public loop: boolean = false;
    public loopStartTicks: number = 0;
    public loopEndTicks: number = 0;

    // Callbacks
    private visualListeners: ((data: any) => void)[] = [];
    private endListeners: (() => void)[] = [];

    // Muted channels
    private mutedChannels: Set<number> = new Set();

    public init(synth: WorkletSynthesizer) {
        this.synth = synth;
    }

    public muteChannel(channel: number, mute: boolean) {
        if (mute) {
            this.mutedChannels.add(channel);
            if (this.synth) {
                this.synth.controllerChange(channel, 123, 0); // All Notes Off
                this.synth.controllerChange(channel, 120, 0); // All Sound Off
            }
        } else {
            this.mutedChannels.delete(channel);
        }
    }

    public isChannelMuted(channel: number): boolean {
        return this.mutedChannels.has(channel);
    }

    public injectEvent(ev: MidiEvent) {
        // Insert event into the sorted events array
        const index = this.events.findIndex(e => e.ticks > ev.ticks);
        if (index === -1) {
            this.events.push(ev);
        } else {
            this.events.splice(index, 0, ev);
            // If the injected event is before the current eventIndex, increment eventIndex
            if (index <= this.eventIndex) {
                this.eventIndex++;
            }
        }
    }

    public getChannelEvents(channel: number): MidiEvent[] {
        return this.events.filter(e => e.channel === channel);
    }

    public replaceChannelEvents(channel: number, startTick: number, newEvents: MidiEvent[]) {
        // Remove all events for this channel from startTick onwards
        this.events = this.events.filter(e => !(e.channel === channel && e.ticks >= startTick));
        
        // Add new events
        this.events.push(...newEvents);
        
        // Re-sort events
        this.events.sort((a, b) => a.ticks - b.ticks);
        
        // Recalculate eventIndex
        this.eventIndex = 0;
        while (this.eventIndex < this.events.length && this.events[this.eventIndex].ticks < this.currentTick) {
            this.eventIndex++;
        }
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
    public loadTrack(events: MidiEvent[], bpm: number, tempoCurves?: TempoCurve[]) {
        // Ensure events are strictly sorted by time
        this.events = events.sort((a, b) => a.ticks - b.ticks);
        this.baseBpm = bpm;
        this.currentBpm = bpm;
        this.tempoCurves = tempoCurves || [];
        this.eventIndex = 0;
        this.currentTick = 0;
        this.mutedChannels.clear();
    }

    public setBpm(bpm: number) {
        this.baseBpm = bpm;
        this.currentBpm = bpm;
    }

    public getBpm(): number {
        return this.currentBpm;
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
        this.timerId = requestAnimationFrame(this.tickLoop);
    }

    public stop() {
        this.isPlaying = false;
        if (this.timerId !== null) {
            cancelAnimationFrame(this.timerId);
            this.timerId = null;
        }
        this.currentTick = 0;
        this.eventIndex = 0;
        this.panic();
    }

    public pause() {
        this.isPlaying = false;
        if (this.timerId !== null) {
            cancelAnimationFrame(this.timerId);
            this.timerId = null;
        }
        // Silence all currently playing notes, but keep the playhead position
        this.panic();
    }

    public clear() {
        this.stop();
        this.events = [];
        this.tempoCurves = [];
        this.visualListeners = [];
        this.endListeners = [];
        this.mutedChannels.clear();
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

    private updateBpm() {
        let newBpm = this.baseBpm;
        for (const curve of this.tempoCurves) {
            if (this.currentTick >= curve.startTick && this.currentTick <= curve.endTick) {
                const progress = (this.currentTick - curve.startTick) / (curve.endTick - curve.startTick);
                if (curve.curveType === 'linear') {
                    newBpm = curve.startBpm + (curve.endBpm - curve.startBpm) * progress;
                } else if (curve.curveType === 'exponential') {
                    // Exponential interpolation
                    newBpm = curve.startBpm * Math.pow(curve.endBpm / curve.startBpm, progress);
                }
                break; // Apply the first matching curve
            } else if (this.currentTick > curve.endTick) {
                // If we passed the curve, hold the endBpm (assuming curves are sequential)
                newBpm = curve.endBpm;
            }
        }
        this.currentBpm = newBpm;
    }

    /**
     * The core timing loop. Mimics a hardware timer interrupt.
     */
    private tickLoop = (now: number) => {
        if (!this.isPlaying) return;

        const deltaMs = now - this.lastTimeMs;
        this.lastTimeMs = now;

        // Update BPM based on tempo curves
        this.updateBpm();

        // Calculate how many ticks passed based on current BPM
        // 1 beat = 60000 / BPM ms
        // 1 tick = (60000 / BPM) / PPQ ms
        const msPerTick = (60000 / this.currentBpm) / this.ppq;
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
            this.timerId = requestAnimationFrame(this.tickLoop);
        } else {
            this.isPlaying = false; // Track finished
            this.endListeners.forEach(l => l());
        }
    }

    private dispatchEvent(ev: MidiEvent) {
        if (!this.synth) return;
        
        // Skip note events for muted channels
        if (this.mutedChannels.has(ev.channel) && (ev.type === 'noteOn' || ev.type === 'noteOff')) {
            return;
        }

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
            case 'pitchBend':
                this.synth.pitchWheel(ev.channel, ev.data1);
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
