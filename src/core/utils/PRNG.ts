/**
 * Deterministic Pseudo-Random Number Generator (PRNG)
 * 
 * Essential for C/C++ porting to ensure that the same seed produces the exact same 
 * musical output on both the Web Simulator and the ESP32-S3 hardware.
 * Replaces Math.random() in core generation logic.
 */
class PRNG {
    private state: number;

    constructor(seed: number) {
        this.state = seed;
    }

    // LCG (Linear Congruential Generator) - Fast and C-friendly
    public next(): number {
        this.state = (this.state * 1664525 + 1013904223) % 4294967296;
        return this.state / 4294967296;
    }

    public nextInt(min: number, max: number): number {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    public nextFloat(min: number, max: number): number {
        return this.next() * (max - min) + min;
    }

    public setSeed(seed: number): void {
        this.state = seed;
    }

    public getState(): number {
        return this.state;
    }

    public setState(state: number): void {
        this.state = state;
    }
}

// Export as a unified manager
export const PRNGManager = new PRNG(Date.now());

