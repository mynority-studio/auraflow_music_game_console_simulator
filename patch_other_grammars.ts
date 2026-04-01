import fs from 'fs';

const files = [
    './src/core/generation/styles/RockGrammar.ts',
    './src/core/generation/styles/JazzGrammar.ts',
    './src/core/generation/styles/FolkGrammar.ts',
    './src/core/generation/styles/RnBGrammar.ts'
];

for (const file of files) {
    if (fs.existsSync(file)) {
        let content = fs.readFileSync(file, 'utf8');
        
        // Add more bodies to highEnergy
        content = content.replace(
            /bodies: \[\s+\[([^\]]+)\],\s+\[([^\]]+)\],\s+\[([^\]]+)\]\s+\],/,
            `bodies: [
                [$1],
                [$2],
                [$3],
                [0.0, 0.5, 1.0, 1.5], // Straight 8ths
                [0.0, 0.75, 1.0, 1.75], // Offbeat heavy
                [0.0, 0.25, 1.0, 1.25], // Broken 16ths
                [0.0, 0.5, 0.75, 1.0, 1.5] // Dense syncopation
            ],`
        );
        
        // Add more bodies to lowEnergy
        content = content.replace(
            /bodies: \[\s+\[([^\]]+)\],\s+\[([^\]]+)\],\s+\[([^\]]+)\]\s+\],/,
            `bodies: [
                [$1],
                [$2],
                [$3],
                [0.0, 0.5, 1.5], // Sparse
                [0.0, 1.0, 2.0], // Half notes
                [0.5, 1.5, 2.5]  // Offbeats
            ],`
        );
        
        fs.writeFileSync(file, content);
        console.log('Patched ' + file);
    }
}
