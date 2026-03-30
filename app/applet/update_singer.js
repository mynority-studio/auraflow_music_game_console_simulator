const fs = require('fs');
let content = fs.readFileSync('/app/applet/src/core/generation/performance/SingerPersona.ts', 'utf8');

content = content.replace(
    "// 3. 句首转音 (Grace Notes) - 🌟 修复点：钢琴/吉他关闭\n            // 钢琴的倚音应该非常克制，否则会显得很烦人。ToplineEngine 已经处理了钢琴的倚音，这里完全关闭。\n            const graceProb = isPianoOrGuitar ? 0 : persona.traits.graceNoteProbability;\n            \n            if ((isPhraseStart || isLongNote) && globalPRNG.next() < graceProb) {\n                const graceDur = 0.12; \n                // 🌟 使用 Diatonic Shift：严格从当前音阶的“下方一阶”滑上来！绝对和谐！\n                const gracePitch = HarmonyCore.shiftDiatonic(current.pitch, safeTones, -1);\n                \n                result.push({\n                    pitch: gracePitch,\n                    onset: current.onset - graceDur,\n                    duration: graceDur,\n                    velocity: current.velocity * 0.4, // 降低人声转音力度\n                    isGraceNote: true\n                });\n                current.duration -= graceDur; \n            }",
    `// 3. 句首转音 (Grace Notes) & R&B Riffs - 🌟 修复点：钢琴/吉他关闭
            // 钢琴的倚音应该非常克制，否则会显得很烦人。ToplineEngine 已经处理了钢琴的倚音，这里完全关闭。
            const graceProb = isPianoOrGuitar ? 0 : persona.traits.graceNoteProbability;
            
            if ((isPhraseStart || isLongNote) && globalPRNG.next() < graceProb) {
                // 🌟 R&B Riffs: 决定是单音转音还是多音 Riff
                const isRiff = globalPRNG.next() < (persona.traits.graceNoteProbability * 0.5); // 概率与 graceProb 正相关
                
                if (isRiff && isLongNote) {
                    // 插入 2-3 个短促的装饰音 (Riff)
                    const riffCount = globalPRNG.next() > 0.5 ? 2 : 3;
                    const riffDur = 0.08; // 极短的 32 分音符感觉
                    
                    let currentGracePitch = current.pitch;
                    for (let r = riffCount; r > 0; r--) {
                        // 顺着音阶往下找，形成一个上行的 Riff (例如 5-6-1)
                        currentGracePitch = HarmonyCore.shiftDiatonic(currentGracePitch, safeTones, -1);
                        result.push({
                            pitch: currentGracePitch,
                            onset: current.onset - (r * riffDur),
                            duration: riffDur,
                            velocity: current.velocity * 0.5,
                            isGraceNote: true
                        });
                    }
                    current.duration -= (riffCount * riffDur);
                } else {
                    // 普通单音转音
                    const graceDur = 0.12; 
                    // 🌟 使用 Diatonic Shift：严格从当前音阶的“下方一阶”滑上来！绝对和谐！
                    const gracePitch = HarmonyCore.shiftDiatonic(current.pitch, safeTones, -1);
                    
                    result.push({
                        pitch: gracePitch,
                        onset: current.onset - graceDur,
                        duration: graceDur,
                        velocity: current.velocity * 0.4, // 降低人声转音力度
                        isGraceNote: true
                    });
                    current.duration -= graceDur; 
                }
            }`
);

fs.writeFileSync('/app/applet/src/core/generation/performance/SingerPersona.ts', content);
