/**
 * Deterministic Pseudo-Random Number Generator (PRNG)
 *
 * Essential for C/C++ porting to ensure that the same seed produces the exact same
 * musical output on both the Web Simulator and the ESP32-S3 hardware.
 * Replaces Math.random() in core generation logic.
 *
 * Snapshot mechanism (ACVE §5.1):
 *   - 'A' captured at setSeed() / 播放入口
 *   - 'B' captured at MelodyEngine.generateFullSong() 入口
 *   - 'C' captured at AbsoluteTransposer.arrange() 入口
 *   - 'D' captured at MidiConverter.convert() 入口
 *
 * 这些 snapshot 用于隔离验证修改是否影响 PRNG 消耗序列。
 * 开发者可在测试中调用 PRNGManager.getSnapshot('B') 拿到当时的 state，
 * 配合 setState() 即可在不重跑整曲的前提下重放某一阶段。
 */
export type PRNGSnapshotKey = 'A' | 'B' | 'C' | 'D';

class PRNG {
    private state: number;
    private lastSeed: number = 0;
    private snapshots: { A?: number; B?: number; C?: number; D?: number } = {};

    constructor(seed: number) {
        this.state = seed;
        this.lastSeed = seed >>> 0;
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
        this.lastSeed = seed >>> 0;
        // 新 seed = 新一轮生成，清空所有 snapshot
        this.snapshots = {};
    }

    public getInitialSeed(): number {
        return this.lastSeed;
    }

    public getState(): number {
        return this.state;
    }

    public setState(state: number): void {
        this.state = state;
    }

    /**
     * 在管道关键节点记录当前 state。
     * key 必须是 'A'/'B'/'C'/'D' 之一，对应 ACVE §5.1 的四个快照点。
     * 重复调用同一 key 会覆盖之前的快照。
     */
    public recordSnapshot(key: PRNGSnapshotKey): void {
        this.snapshots[key] = this.state;
    }

    /**
     * 读取已记录的快照。返回 undefined 表示该快照点尚未被触发。
     */
    public getSnapshot(key: PRNGSnapshotKey): number | undefined {
        return this.snapshots[key];
    }

    /**
     * 一次性返回所有快照（便于序列化/对比）。
     */
    public getAllSnapshots(): { A?: number; B?: number; C?: number; D?: number } {
        return { ...this.snapshots };
    }
}

// D-2 合规：使用固定初始种子，播放入口处由调用方显式 setSeed() 覆盖
export const PRNGManager = new PRNG(0);

