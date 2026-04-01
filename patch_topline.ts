import fs from 'fs';

const file = './src/core/generation/composing/ToplineEngine.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
    /switch \(contour\) \{\s+case 'Ascending':\s+idealPitch = targetCenter - range\/2 \+ safeProgress \* range;\s+\/\/ 增加局部起伏\s+if \(i > 0 && PRNGManager\.next\(\) < 0\.3\) idealPitch -= \(PRNGManager\.next\(\) \* 3\);\s+break;\s+case 'Descending':\s+idealPitch = targetCenter \+ range\/2 - safeProgress \* range;\s+\/\/ 增加局部起伏\s+if \(i > 0 && PRNGManager\.next\(\) < 0\.3\) idealPitch \+= \(PRNGManager\.next\(\) \* 3\);\s+break;\s+case 'Arch':\s+idealPitch = targetCenter - range\/2 \+ Math\.sin\(safeProgress \* Math\.PI\) \* range;\s+break;\s+case 'Bowl':\s+idealPitch = targetCenter \+ range\/2 - Math\.sin\(safeProgress \* Math\.PI\) \* range;\s+break;/,
    `switch (contour) {
                case 'Ascending': 
                    idealPitch = targetCenter - range/2 + safeProgress * range; 
                    if (i > 0 && PRNGManager.next() < 0.5) idealPitch += (PRNGManager.next() * 4 - 2);
                    break;
                case 'Descending': 
                    idealPitch = targetCenter + range/2 - safeProgress * range; 
                    if (i > 0 && PRNGManager.next() < 0.5) idealPitch += (PRNGManager.next() * 4 - 2);
                    break;
                case 'Arch': 
                    idealPitch = targetCenter - range/2 + Math.sin(safeProgress * Math.PI) * range; 
                    if (i > 0 && PRNGManager.next() < 0.5) idealPitch += (PRNGManager.next() * 4 - 2);
                    break;
                case 'Bowl': 
                    idealPitch = targetCenter + range/2 - Math.sin(safeProgress * Math.PI) * range; 
                    if (i > 0 && PRNGManager.next() < 0.5) idealPitch += (PRNGManager.next() * 4 - 2);
                    break;`
);

fs.writeFileSync(file, content);
console.log('Patched ToplineEngine.ts');
