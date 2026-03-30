const fs = require('fs');
let content = fs.readFileSync('src/core/generation/composing/ToplineEngine.ts', 'utf8');

content = content.replace(
    "if (section.name.includes('Chorus')) {\n            pitchOffset = style.contrast.chorusPitchOffset || 5;\n        } else if (section.name.includes('Solo')) {",
    "if (section.name.includes('Chorus')) {\n            pitchOffset = style.contrast.chorusPitchOffset || 5;\n            // 🌟 爆款副歌理论：Detonator (引爆器) 机制\n            if (maxPitchBeforeChorus > 0) {\n                const minimumChorusPeak = maxPitchBeforeChorus + 3;\n                if (60 + pitchOffset < minimumChorusPeak - 4) {\n                    pitchOffset = minimumChorusPeak - 60 - 2;\n                }\n            }\n        } else if (section.name.includes('Solo')) {"
);

fs.writeFileSync('src/core/generation/composing/ToplineEngine.ts', content);
