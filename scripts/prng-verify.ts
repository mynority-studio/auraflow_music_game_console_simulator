/**
 * Phase 1.3 — PRNG 验证数据录制
 *
 * seed=12345 跑 10000 步，输出每步 state + next() 返回值。
 * 另外录制 nextInt / nextFloat 派生方法的验证数据。
 * 用于 C 侧逐步比对。
 *
 * 运行：npx tsx scripts/prng-verify.ts
 */
import { writeFileSync } from 'node:fs';
import { PRNGManager } from '../src/core/utils/PRNG';

const SEED = 12345;
const STEPS = 10000;

function run() {
    // Part 1: next() 序列 — 10000 步
    PRNGManager.setSeed(SEED);
    const states: number[] = [];
    const values: number[] = [];

    for (let i = 0; i < STEPS; i++) {
        const val = PRNGManager.next();
        const state = PRNGManager.getState();
        states.push(state);
        values.push(val);
    }

    // Part 2: nextInt 验证（100 次）
    PRNGManager.setSeed(SEED);
    const nextIntResults: { min: number; max: number; result: number; state: number }[] = [];
    const intTestCases = [
        { min: 0, max: 10 },
        { min: 1, max: 100 },
        { min: -5, max: 5 },
        { min: 0, max: 1 },
        { min: 60, max: 84 },
    ];
    for (let i = 0; i < 100; i++) {
        const tc = intTestCases[i % intTestCases.length];
        const result = PRNGManager.nextInt(tc.min, tc.max);
        nextIntResults.push({ ...tc, result, state: PRNGManager.getState() });
    }

    // Part 3: nextFloat 验证（100 次）
    PRNGManager.setSeed(SEED);
    const nextFloatResults: { min: number; max: number; result: number; state: number }[] = [];
    const floatTestCases = [
        { min: 0.0, max: 1.0 },
        { min: -1.0, max: 1.0 },
        { min: 0.5, max: 0.9 },
        { min: 60.0, max: 200.0 },
        { min: 0.0, max: 0.01 },
    ];
    for (let i = 0; i < 100; i++) {
        const tc = floatTestCases[i % floatTestCases.length];
        const result = PRNGManager.nextFloat(tc.min, tc.max);
        nextFloatResults.push({ ...tc, result, state: PRNGManager.getState() });
    }

    const output = {
        seed: SEED,
        steps: STEPS,
        prngAlgorithm: 'LCG: state = (state * 1664525 + 1013904223) % 4294967296',
        sequence: {
            description: 'state[i] and value[i] are AFTER the i-th call to next()',
            first20States: states.slice(0, 20),
            first20Values: values.slice(0, 20),
            last5States: states.slice(-5),
            last5Values: values.slice(-5),
            state_at_1000: states[999],
            state_at_5000: states[4999],
            state_at_10000: states[9999],
        },
        nextInt: {
            description: 'PRNG reset to same seed, 100 calls to nextInt with varying ranges',
            first10: nextIntResults.slice(0, 10),
        },
        nextFloat: {
            description: 'PRNG reset to same seed, 100 calls to nextFloat with varying ranges',
            first10: nextFloatResults.slice(0, 10),
        },
        // Full state dump for C comparison (compact: one state per line)
        fullStates: states,
    };

    const outPath = new URL('./prng-verify-output.json', import.meta.url).pathname;
    writeFileSync(outPath, JSON.stringify(output, null, 2));

    // Print summary
    console.log(`PRNG Verification Data — seed=${SEED}, ${STEPS} steps`);
    console.log('='.repeat(50));
    console.log(`State after step 1:     ${states[0]}`);
    console.log(`State after step 1000:  ${states[999]}`);
    console.log(`State after step 5000:  ${states[4999]}`);
    console.log(`State after step 10000: ${states[9999]}`);
    console.log(`\nFirst 5 values: ${values.slice(0, 5).map(v => v.toFixed(10)).join(', ')}`);
    console.log(`\nOutput: ${outPath}`);
}

run();
