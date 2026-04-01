import fs from 'fs';

const file = './src/core/generation/styles/PopGrammar.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
    /bodies: \[\s+\[0\.0, 0\.375, 0\.75\], \/\/ Tresillo\s+\[0\.0, 0\.5, 0\.75, 1\.0\], \s+\[0\.0, 0\.25, 0\.5, 1\.0\]\s+\],/,
    `bodies: [
                [0.0, 0.375, 0.75], // Tresillo
                [0.0, 0.5, 0.75, 1.0], 
                [0.0, 0.25, 0.5, 1.0],
                [0.0, 0.5, 1.0, 1.5], // Straight 8ths
                [0.0, 0.75, 1.0, 1.75], // Offbeat heavy
                [0.0, 0.25, 1.0, 1.25], // Broken 16ths
                [0.0, 0.5, 0.75, 1.0, 1.5] // Dense syncopation
            ],`
);

content = content.replace(
    /bodies: \[\s+\[0\.0, 0\.5, 1\.0\], \s+\[0\.0, 1\.0\],\s+\[0\.0, 0\.5, 1\.5\]\s+\],/,
    `bodies: [
                [0.0, 0.5, 1.0], 
                [0.0, 1.0],
                [0.0, 0.5, 1.5],
                [0.0, 1.0, 2.0], // Half notes
                [0.5, 1.5, 2.5]  // Offbeats
            ],`
);

fs.writeFileSync(file, content);
console.log('Patched PopGrammar.ts');
