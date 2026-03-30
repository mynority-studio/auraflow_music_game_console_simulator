const fs = require('fs');
let content = fs.readFileSync('src/core/generation/composing/ToplineEngine.ts', 'utf8');

content = content.replace(
    "if (isInv || isRet || isAug) {\n                template = this.transformMotif(template, { isInv, isRet, isAug });",
    "if (isInv || isRet || isAug || isSwitcheroo) {\n                template = this.transformMotif(template, { isInv, isRet, isAug, isSwitcheroo });"
);

fs.writeFileSync('src/core/generation/composing/ToplineEngine.ts', content);
