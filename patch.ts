import fs from 'fs';

const file = './src/core/generation/composing/GrooveEngine.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
    /possibleSteps\.forEach\(s => s\.weight = s\.weight \* \(0\.5 \+ PRNGManager\.next\(\) \* 0\.5\)\); \/\/ 降低完全随机的影响\s+possibleSteps\.sort\(\(a, b\) => b\.weight - a\.weight\);\s+let fingerprint: number\[\] = \[0\]; \/\/ 第0拍永远有锚点\s+for \(let i = 0; i < targetNotesCount - 1 && i < possibleSteps\.length; i\+\+\) \{\s+fingerprint\.push\(possibleSteps\[i\]\.offset\);\s+\}/,
    `let fingerprint: number[] = [0]; // 第0拍永远有锚点
        let availableSteps = [...possibleSteps];
        for (let i = 0; i < targetNotesCount - 1 && availableSteps.length > 0; i++) {
            let totalWeight = availableSteps.reduce((sum, step) => sum + step.weight, 0);
            let randomVal = PRNGManager.next() * totalWeight;
            let selectedIdx = 0;
            for (let j = 0; j < availableSteps.length; j++) {
                randomVal -= availableSteps[j].weight;
                if (randomVal <= 0) {
                    selectedIdx = j;
                    break;
                }
            }
            fingerprint.push(availableSteps[selectedIdx].offset);
            availableSteps.splice(selectedIdx, 1);
        }`
);

content = content.replace(
    /possibleSteps\.forEach\(s => s\.weight \*= \(0\.5 \+ PRNGManager\.next\(\) \* 0\.5\)\);\s+possibleSteps\.sort\(\(a, b\) => b\.weight - a\.weight\);\s+let inverseFingerprint: number\[\] = \[0\]; \/\/ 强拍锚点\s+for \(let i = 0; i < targetNotesCount - 1 && i < possibleSteps\.length; i\+\+\) \{\s+inverseFingerprint\.push\(possibleSteps\[i\]\.offset\);\s+\}/,
    `let inverseFingerprint: number[] = [0]; // 强拍锚点
        let availableSteps = [...possibleSteps];
        for (let i = 0; i < targetNotesCount - 1 && availableSteps.length > 0; i++) {
            let totalWeight = availableSteps.reduce((sum, step) => sum + step.weight, 0);
            let randomVal = PRNGManager.next() * totalWeight;
            let selectedIdx = 0;
            for (let j = 0; j < availableSteps.length; j++) {
                randomVal -= availableSteps[j].weight;
                if (randomVal <= 0) {
                    selectedIdx = j;
                    break;
                }
            }
            inverseFingerprint.push(availableSteps[selectedIdx].offset);
            availableSteps.splice(selectedIdx, 1);
        }`
);

fs.writeFileSync(file, content);
console.log('Patched GrooveEngine.ts');
