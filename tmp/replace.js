const fs = require('fs');
let content = fs.readFileSync('./src/core/generation/composing/ToplineEngine.ts', 'utf8');
content = content.replace(/if \(isVocal\) \{\s*maxPitch = 72; \/\/ C5\s*minPitch = 55; \/\/ G3\s*\}\s*if \(currentPitch > maxPitch\) currentPitch = HarmonyCore.shiftDiatonic\(currentPitch, safeScalePcs, -2\);/g, 
`if (isVocal) {
                maxPitch = 72; // C5
                minPitch = 55; // G3
            }
            const keyOffset = activeChord.keyOffset !== undefined ? activeChord.keyOffset : (GlobalContext.currentKeyOffset || 0);
            maxPitch -= keyOffset;
            minPitch -= keyOffset;
            
            if (currentPitch > maxPitch) currentPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, -2);`);
fs.writeFileSync('./src/core/generation/composing/ToplineEngine.ts', content);
