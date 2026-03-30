import * as fs from 'fs';

let content = fs.readFileSync('src/core/generation/performance/SingerPersona.ts', 'utf8');

const target = `            if ((isPhraseStart || isLongNote) && globalPRNG.next() < graceProb) {
                const isRiff = globalPRNG.next() < (persona.traits.graceNoteProbability * 0.5); if (isRiff && isLongNote) { const riffCount = globalPRNG.next() > 0.5 ? 2 : 3; const riffDur = 0.08; let currentGracePitch = current.pitch; for (let r = riffCount; r > 0; r--) { currentGracePitch = HarmonyCore.shiftDiatonic(currentGracePitch, safeTones, -1); result.push({ pitch: currentGracePitch, onset: current.onset - (r * riffDur), duration: riffDur, velocity: current.velocity * 0.5, isGraceNote: true }); } current.duration -= (riffCount * riffDur); } else { const graceDur = 0.12; 
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
            }`;

const replacement = `            if ((isPhraseStart || isLongNote) && globalPRNG.next() < graceProb) {
                const isRiff = globalPRNG.next() < (persona.traits.graceNoteProbability * 0.5); 
                if (isRiff && isLongNote) { 
                    const riffCount = globalPRNG.next() > 0.5 ? 2 : 3; 
                    const riffDur = 0.08; 
                    let currentGracePitch = current.pitch; 
                    for (let r = riffCount; r > 0; r--) { 
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
                    const graceDur = 0.12; 
                    const gracePitch = HarmonyCore.shiftDiatonic(current.pitch, safeTones, -1);
                    
                    result.push({
                        pitch: gracePitch,
                        onset: current.onset - graceDur,
                        duration: graceDur,
                        velocity: current.velocity * 0.4,
                        isGraceNote: true
                    });
                    current.duration -= graceDur; 
                }
            }`;

content = content.replace(target, replacement);
fs.writeFileSync('src/core/generation/performance/SingerPersona.ts', content);
