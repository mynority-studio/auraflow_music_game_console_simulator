import fs from 'fs';

const file = './src/core/generation/composing/ToplineEngine.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
    /if \(PRNGManager\.next\(\) > 0\.5 && baseGroove && baseGroove\.length > 0\) \{\s+\/\/ 使用动态 baseGroove\s+const grooveSubset = baseGroove\.filter\(b => PRNGManager\.next\(\) < Math\.min\(1\.0, density \* 1\.5\)\);\s+let maxB = 0;\s+for \(const b of grooveSubset\) \{\s+const onset = currentBeat \+ \(b % 4\); \/\/ 映射到 1 小节内\s+if \(onset < phraseLength - 1\.0\) \{\s+offsets\.push\(onset\);\s+if \(\(b % 4\) > maxB\) maxB = \(b % 4\);\s+\}\s+\}\s+currentBeat \+= Math\.ceil\(maxB \+ 0\.5\);\s+if \(currentBeat === 0\) currentBeat \+= 2\.0; \/\/ 防止死循环\s+\}/,
    `if (PRNGManager.next() > 0.5 && baseGroove && baseGroove.length > 0) {
                // 使用动态 baseGroove
                const grooveSubset = baseGroove.filter(b => PRNGManager.next() < Math.min(1.0, density * 1.5));
                let maxB = 0;
                // 随机选择一个起始小节，增加变化
                const measureOffset = (Math.floor(PRNGManager.next() * 2) * 4); 
                for (const b of grooveSubset) {
                    // 只取当前随机选择的小节内的音符
                    if (b >= measureOffset && b < measureOffset + 4) {
                        const localB = b - measureOffset;
                        const onset = currentBeat + localB;
                        if (onset < phraseLength - 1.0) {
                            offsets.push(onset);
                            if (localB > maxB) maxB = localB;
                        }
                    }
                }
                currentBeat += Math.ceil(maxB + 0.5);
                if (currentBeat === 0) currentBeat += 2.0; // 防止死循环
            }`
);

fs.writeFileSync(file, content);
console.log('Patched ToplineEngine.ts generateMotifRhythm');
