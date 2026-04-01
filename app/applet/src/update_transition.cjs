const fs = require('fs');
const file = './src/core/generation/arrangement/TransitionEngine.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
    "// 强制 Drop 前悬空 1 拍\n                this.injectDrop(lh, rh, drums, boundaryBeat, 1.0);",
    "// 强制 Drop 前悬空 1 拍\n                this.injectDrop(lh, rh, drums, boundaryBeat, 1.0);\n                // 🌟 P2: 添加 Reverse Cymbal (Riser)\n                this.injectReverseCymbal(drums, boundaryBeat, 4.0);"
);

content = content.replace(
    "// 30% 概率：The Drop (情绪悬空 1 拍)\n                    this.injectDrop(lh, rh, drums, boundaryBeat, 1.0);\n                } else if (transitionRoll < 0.6) {\n                    // 30% 概率：Massive Build-up (Snare Roll + Cymbal Swell)\n                    this.injectBuildUp(drums, boundaryBeat, 2.0);\n                } else {\n                    // 40% 概率：完整的 Drum Fill (1 小节)\n                    this.injectDrumFill(drums, lastBarStart, boundaryBeat, delta, currentEnergy, styleId);\n                }",
    "// 25% 概率：The Drop (情绪悬空 1 拍)\n                    this.injectDrop(lh, rh, drums, boundaryBeat, 1.0);\n                } else if (transitionRoll < 0.5) {\n                    // 25% 概率：Massive Build-up (Snare Roll + Cymbal Swell)\n                    this.injectBuildUp(drums, boundaryBeat, 2.0);\n                } else if (transitionRoll < 0.65) {\n                    // 15% 概率：Reverse Cymbal (Riser)\n                    this.injectReverseCymbal(drums, boundaryBeat, 2.0);\n                } else {\n                    // 35% 概率：完整的 Drum Fill (1 小节)\n                    this.injectDrumFill(drums, lastBarStart, boundaryBeat, delta, currentEnergy, styleId);\n                }"
);

content = content.replace(
    "drums.push({ pitch: 36, onset: dropStart + 1.0, duration: 0.5, velocity: 0.7 });\n            }",
    "drums.push({ pitch: 36, onset: dropStart + 1.0, duration: 0.5, velocity: 0.7 });\n                \n                // 🌟 P2: 添加 Sub Drop (低频下潜)，增强失重感\n                if (globalPRNG.next() > 0.3) {\n                    this.injectSubDrop(lh, boundaryBeat);\n                }\n            }"
);

// Also handle \r\n
content = content.replace(
    "// 强制 Drop 前悬空 1 拍\r\n                this.injectDrop(lh, rh, drums, boundaryBeat, 1.0);",
    "// 强制 Drop 前悬空 1 拍\r\n                this.injectDrop(lh, rh, drums, boundaryBeat, 1.0);\r\n                // 🌟 P2: 添加 Reverse Cymbal (Riser)\r\n                this.injectReverseCymbal(drums, boundaryBeat, 4.0);"
);

content = content.replace(
    "// 30% 概率：The Drop (情绪悬空 1 拍)\r\n                    this.injectDrop(lh, rh, drums, boundaryBeat, 1.0);\r\n                } else if (transitionRoll < 0.6) {\r\n                    // 30% 概率：Massive Build-up (Snare Roll + Cymbal Swell)\r\n                    this.injectBuildUp(drums, boundaryBeat, 2.0);\r\n                } else {\r\n                    // 40% 概率：完整的 Drum Fill (1 小节)\r\n                    this.injectDrumFill(drums, lastBarStart, boundaryBeat, delta, currentEnergy, styleId);\r\n                }",
    "// 25% 概率：The Drop (情绪悬空 1 拍)\r\n                    this.injectDrop(lh, rh, drums, boundaryBeat, 1.0);\r\n                } else if (transitionRoll < 0.5) {\r\n                    // 25% 概率：Massive Build-up (Snare Roll + Cymbal Swell)\r\n                    this.injectBuildUp(drums, boundaryBeat, 2.0);\r\n                } else if (transitionRoll < 0.65) {\r\n                    // 15% 概率：Reverse Cymbal (Riser)\r\n                    this.injectReverseCymbal(drums, boundaryBeat, 2.0);\r\n                } else {\r\n                    // 35% 概率：完整的 Drum Fill (1 小节)\r\n                    this.injectDrumFill(drums, lastBarStart, boundaryBeat, delta, currentEnergy, styleId);\r\n                }"
);

content = content.replace(
    "drums.push({ pitch: 36, onset: dropStart + 1.0, duration: 0.5, velocity: 0.7 });\r\n            }",
    "drums.push({ pitch: 36, onset: dropStart + 1.0, duration: 0.5, velocity: 0.7 });\r\n                \r\n                // 🌟 P2: 添加 Sub Drop (低频下潜)，增强失重感\r\n                if (globalPRNG.next() > 0.3) {\r\n                    this.injectSubDrop(lh, boundaryBeat);\r\n                }\r\n            }"
);

fs.writeFileSync(file, content);
console.log('Done');
