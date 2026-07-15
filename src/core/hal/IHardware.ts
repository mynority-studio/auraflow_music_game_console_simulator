/**
 * Hardware Abstraction Layer (HAL) Interfaces
 * 
 * These interfaces define the boundary between the core logic and the physical hardware.
 * In the web simulator, these are implemented using React/DOM/Web MIDI.
 * On the ESP32-S3, these will be implemented using C++/FreeRTOS drivers (SPI, I2C, I2S).
 */

export interface ILedMatrix {
    /** ESP32: Maps to SPI/RMT driver for WS2812/APA102 */
    setPixel(x: number, y: number, r: number, g: number, b: number): void;
    update(): void;
    clear(): void;
}

export interface ITouchPad {
    /** ESP32: Maps to I2C driver (e.g., MPR121, CST816S) or native Touch peripheral */
    getTouchState(padIndex: number): boolean;
    onPadDown(callback: (padIndex: number) => void): void;
    onPadUp(callback: (padIndex: number) => void): void;
}

export interface IAudioOut {
    /** Hardware synth: maps to Dream/SAM MIDI note/program/CC output. */
    playNote(pitch: number, velocity: number, durationMs: number, instrumentId: number): void;
    stopNote(pitch: number, instrumentId: number): void;
    setVolume(level: number): void;
}

export interface ISystemTimer {
    /** ESP32: Maps to xTaskGetTickCount() or esp_timer_get_time() */
    getTicksMs(): number;
    delay(ms: number): Promise<void>;
}
