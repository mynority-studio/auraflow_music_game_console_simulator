import { ILedMatrix, ITouchPad, IAudioOut, ISystemTimer } from './IHardware';

/**
 * Web Simulator implementation of the Hardware Abstraction Layer (HAL).
 * 
 * In the web browser, this class wraps DOM APIs, React state dispatchers, 
 * and Web Audio API to simulate the physical hardware.
 * 
 * On the ESP32-S3, this file will be completely ignored and replaced by 
 * C++ drivers (e.g., EspI2sAudioOut, EspSpiLedMatrix).
 */
export class WebSimulatorHAL implements ILedMatrix, ITouchPad, IAudioOut, ISystemTimer {
    
    // --- ILedMatrix Implementation (Simulated via React State/DOM) ---
    public setPixel(x: number, y: number, r: number, g: number, b: number): void {
        // In a real implementation, this would dispatch to a React Context or directly manipulate a Canvas pixel
        // console.log(`[WebHAL] setPixel(${x}, ${y}) -> rgb(${r},${g},${b})`);
    }

    public update(): void {
        // Trigger React render or Canvas draw
    }

    public clear(): void {
        // Clear virtual LED buffer
    }

    // --- ITouchPad Implementation (Simulated via DOM Pointer Events) ---
    private touchStates: boolean[] = new Array(15).fill(false);
    private padDownCallbacks: ((padIndex: number) => void)[] = [];
    private padUpCallbacks: ((padIndex: number) => void)[] = [];

    public getTouchState(padIndex: number): boolean {
        return this.touchStates[padIndex] || false;
    }

    public onPadDown(callback: (padIndex: number) => void): void {
        this.padDownCallbacks.push(callback);
    }

    public onPadUp(callback: (padIndex: number) => void): void {
        this.padUpCallbacks.push(callback);
    }

    // Internal method to be called by React components when clicked
    public simulatePadDown(padIndex: number) {
        this.touchStates[padIndex] = true;
        this.padDownCallbacks.forEach(cb => cb(padIndex));
    }

    public simulatePadUp(padIndex: number) {
        this.touchStates[padIndex] = false;
        this.padUpCallbacks.forEach(cb => cb(padIndex));
    }

    // --- IAudioOut Implementation (Simulated via Web Audio API / SpessaSynth) ---
    public playNote(pitch: number, velocity: number, durationMs: number, instrumentId: number): void {
        // In the simulator, AudioEngine currently handles SpessaSynth directly.
        // Future refactor: Move SpessaSynth logic here to fully decouple AudioEngine.
        // console.log(`[WebHAL] playNote: pitch=${pitch}, vel=${velocity}, dur=${durationMs}ms`);
    }

    public stopNote(pitch: number, instrumentId: number): void {
        // Stop note
    }

    public setVolume(level: number): void {
        // Set master volume
    }

    // --- ISystemTimer Implementation (Simulated via Browser APIs) ---
    public getTicksMs(): number {
        return performance.now();
    }

    public async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const webHAL = new WebSimulatorHAL();
