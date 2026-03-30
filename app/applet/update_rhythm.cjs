const fs = require('fs');
let content = fs.readFileSync('src/core/generation/composing/ToplineEngine.ts', 'utf8');

content = content.replace(
    "let rhythm = Array.from(offsets).sort((a, b) => a - b);",
    `let rhythm = Array.from(offsets).sort((a, b) => a - b);

        // 🌟 态度与起拍位置 (Attitude & Starting Position)
        // 根据能量层级决定旋律是强拍起（自信/能量）还是弱拍起（内省/慵懒）
        if (rhythm.length > 0) {
            if (energyLevel >= 7 && globalPRNG.next() < 0.7) {
                // 高能量：倾向于强拍起 (Downbeat)
                if (rhythm[0] !== 0) {
                    rhythm.unshift(0);
                }
            } else if (energyLevel <= 4 && globalPRNG.next() < 0.7) {
                // 低能量：倾向于弱拍起 (Offbeat / Syncopated)
                if (rhythm[0] === 0) {
                    rhythm.shift();
                    if (rhythm.length === 0) rhythm.push(0.5);
                }
            }
        }`
);

fs.writeFileSync('src/core/generation/composing/ToplineEngine.ts', content);
