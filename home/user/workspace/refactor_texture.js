const fs = require('fs');
let code = fs.readFileSync('src/core/generation/arrangement/TextureMapper.ts', 'utf8');

if (!code.includes('StyleId')) {
    code = code.replace('import { GlobalContext } from "../GlobalContext";', 
        'import { GlobalContext } from "../GlobalContext";\nimport { StyleId, StyleFlags, StyleFlagTable } from "../config/StyleFlags";');
}

code = code.replace(/styleId: string = "pop"/g, 'styleId: StyleId = StyleId.ModernPop');
code = code.replace(/styleId: string,/g, 'styleId: StyleId,');

code = code.replace(/styleId === "neo_soul"/g, 'styleId === StyleId.NeoSoul');
code = code.replace(/styleId === "progressive_trance"/g, 'styleId === StyleId.Trance');
code = code.replace(/styleId === "eurodance"/g, 'styleId === StyleId.Eurodance');
code = code.replace(/styleId === "synthwave"/g, 'styleId === StyleId.Synthwave');
code = code.replace(/styleId\.toLowerCase\(\) === "eurodance"/g, 'styleId === StyleId.Eurodance');
code = code.replace(/styleId\.toLowerCase\(\) === "progressive_trance"/g, 'styleId === StyleId.Trance');
code = code.replace(/styleId\.toLowerCase\(\) === "synthwave"/g, 'styleId === StyleId.Synthwave');

fs.writeFileSync('src/core/generation/arrangement/TextureMapper.ts', code);
