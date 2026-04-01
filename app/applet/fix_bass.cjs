const fs = require('fs');
const content = fs.readFileSync('src/core/generation/arrangement/TextureMapper.ts', 'utf8');
const lines = content.split('\n');

const newLines = `          if (isTrance) {
            if (energyLevel >= 7) {
              // Drop / 高潮：16分音符滚动 (Rolling Bass)
              // 避开正拍 (Kick的位置)，在 16分音符的反拍上发力，形成伪侧链效果
              const subBeat = beatInBar % 1;
              if (subBeat === 0.25 || subBeat === 0.5 || subBeat === 0.75) {
                const pitch =
                  subBeat === 0.5 && globalPRNG.next() > 0.7
                    ? octaveMidi
                    : targetBassPitch;
                const vel = subBeat === 0.5 ? baseVel * 1.1 : baseVel * 0.9;
                notes.push({
                  pitch: pitch,
                  onset: beat,
                  duration: 0.25,
                  velocity: vel,
                });
              }
            } else if (energyLevel >= 4) {
              // Verse / BuildUp：经典的 Off-beat Bass (反拍贝斯)
              if (beatInBar % 1 === 0.5) {
                notes.push({
                  pitch: targetBassPitch,
                  onset: beat,
                  duration: 0.5,
                  velocity: baseVel * 1.1,
                });
              }
            } else {
              // Breakdown：极简长音或静音
              if (isChordStart) {
                notes.push({
                  pitch: targetBassPitch,
                  onset: beat,
                  duration: 4.0,
                  velocity: baseVel * 0.7,
                });
              }
            }
          } else if (isEurodance) {
              // Eurodance: Strict Off-beat Bass
              if (beatInBar % 1 === 0.5) {
                  notes.push({
                      pitch: targetBassPitch,
                      onset: beat,
                      duration: 0.25, // Short, punchy
                      velocity: baseVel * 1.2,
                  });
              }
          } else if (isSynthwave) {
              // Synthwave: Driving 8th-note or 16th-note bass
              const step = energyLevel >= 7 ? 0.25 : 0.5;
              if (beat % step === 0) {
                  const isDownbeat = beat % 1 === 0;
                  const vel = isDownbeat ? baseVel * 1.1 : baseVel * 0.9;
                  // Occasional octave jumps for flavor
                  const pitch = (!isDownbeat && globalPRNG.next() > 0.8) ? octaveMidi : targetBassPitch;
                  notes.push({
                      pitch: pitch,
                      onset: beat,
                      duration: step * 0.8, // Slightly detached
                      velocity: vel,
                  });
              }
          } else {
            // Funk / 其他电子：高度贴合 GrooveDNA，带有八度跳跃和切分
            // 🌟 P1: 乐器惯用语引擎 (Instrument Idiom Engine) - Bass 演奏法 (Slap vs. Finger)
            const isSlap = isFunk && energyLevel >= 7; // 高能量 Funk 引入 Slap

            if (isChordStart) {
              notes.push({
                pitch: targetBassPitch,
                onset: beat,
                duration: isSlap ? 0.25 : 0.5, // Slap 更短促
                velocity: baseVel * 1.1,
              });
            } else if (isGrooveHit) {
              // 贴合 GrooveDNA
              // Slap 经常使用八度 Pop (高音) 和低音 Slap
              const useOctavePop = isSlap && globalPRNG.next() > 0.4;
              const pitch = useOctavePop
                ? octaveMidi
                : globalPRNG.next() > 0.6
                ? octaveMidi
                : targetBassPitch;
              const duration = isSlap
                ? 0.15
                : globalPRNG.next() > 0.5
                ? 0.25
                : 0.5; // 短促的跳音
              const vel = useOctavePop ? baseVel * 1.2 : baseVel * 0.9; // Pop 力度更大
              notes.push({
                pitch: pitch,
                onset: beat,
                duration: duration,
                velocity: vel,
              });
            } else if (
              (beatInBar === 1.5 || beatInBar === 3.5) &&
              globalPRNG.next() < grooveSyncopation
            ) {
              // 经典的 16 分音符反拍（Ghost notes），受 syncopationProb 控制
              notes.push({
                pitch: targetBassPitch,
                onset: beat,
                duration: 0.15, // Ghost note 更短
                velocity: baseVel * 0.5,
              });
            } else if (
              beat % 0.5 === 0.25 &&
              globalPRNG.next() < grooveDensity - 0.5
            ) {
              // 额外的 16 分音符，受 density 控制
              notes.push({
                pitch: isSlap && globalPRNG.next() > 0.5 ? octaveMidi : targetBassPitch,
                onset: beat,
                duration: 0.15,
                velocity: baseVel * 0.6,
              });
            }
          }`;

// Replace lines 559 to 687
lines.splice(559, 129, newLines);
fs.writeFileSync('src/core/generation/arrangement/TextureMapper.ts', lines.join('\n'));
