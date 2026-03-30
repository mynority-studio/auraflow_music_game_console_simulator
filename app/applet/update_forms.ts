import * as fs from 'fs';

let content = fs.readFileSync('src/core/generation/composing/ToplineEngine.ts', 'utf8');

content = content.replace(
    "['A', 'A_inv', 'B', 'A_prime'],\n            ['A', 'B', 'A_ret', 'C'],",
    "['A', 'A_inv', 'B', 'A_prime'],\n            ['A', 'A_switch', 'B', 'A_prime'],\n            ['A', 'B', 'A_ret', 'C'],"
);

fs.writeFileSync('src/core/generation/composing/ToplineEngine.ts', content);
