// ============================================================
// Random — AF2 自家 PRNG(原 mg-engine/musicEngine.ts copy)
// ============================================================
//
// Seeded random number generator(sine-based mulberry-like)。
// 用法:
//   const rng = new Random('seed-string-or-number');
//   const x = rng.next();       // [0, 1) float
//   const i = rng.range(0, 10); // [0, 10] inclusive integer
//   const item = rng.pick(arr);
//
// 2026-05-24:从 mg-engine 内化到 af2-engine,准备完全删除 mg-engine。
// ============================================================

export class Random {
    private seed: number;

    constructor(seed: number | string) {
        if (typeof seed === 'string') {
            this.seed = seed.split('').reduce((a, b) => {
                a = (a << 5) - a + b.charCodeAt(0);
                return a & a;
            }, 0);
        } else {
            this.seed = seed;
        }
    }

    /** [0, 1) float */
    next(): number {
        const x = Math.sin(this.seed++) * 10000;
        return x - Math.floor(x);
    }

    /** [min, max] inclusive integer */
    range(min: number, max: number): number {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    /** Pick random element from array */
    pick<T>(arr: T[]): T {
        return arr[this.range(0, arr.length - 1)];
    }

    /** Pick with weights, e.g. [{item: 'A', weight: 80}, {item: 'B', weight: 20}] */
    pickWeighted<T>(options: { item: T; weight: number }[]): T {
        const totalWeight = options.reduce((sum, opt) => sum + opt.weight, 0);
        let randomVal = this.next() * totalWeight;
        for (const option of options) {
            if (randomVal < option.weight) return option.item;
            randomVal -= option.weight;
        }
        return options[options.length - 1].item;
    }
}
