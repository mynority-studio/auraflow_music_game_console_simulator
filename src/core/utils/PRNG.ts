/**
 * Deterministic Pseudo-Random Number Generator (PRNG)
 * 
 * Essential for C/C++ porting to ensure that the same seed produces the exact same 
 * musical output on both the Web Simulator and the ESP32-S3 hardware.
 * Replaces Math.random() in core generation logic.
 */
export class PRNG {
    private seed: number;

    constructor(seed: number) {
        this.seed = seed;
    }

    // LCG (Linear Congruential Generator) - Fast and C-friendly
    public next(): number {
        this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
        return this.seed / 4294967296;
    }

    public nextInt(min: number, max: number): number {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    public nextFloat(min: number, max: number): number {
        return this.next() * (max - min) + min;
    }

    public setSeed(seed: number): void {
        this.seed = seed;
    }
}

// Global instance for convenience, though passing instances is preferred for thread-safety in C++
export const globalPRNG = new PRNG(Date.now());
