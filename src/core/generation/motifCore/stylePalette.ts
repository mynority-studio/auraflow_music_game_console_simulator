// ============================================================
// motifCore — 风格调色板(macro 风格 → IMP style 路由)
// ============================================================
//
// Step 0:按音乐性把 5 个 macro 风格映射到 IMP .sty,避免风格混淆
// (鼓/bass/comp 三轨都从这里取同一个 style,保证同源不串味)。
//
// 分工(用户定):
//   - IMP .sty = 节奏/编曲骨架(bass-pattern / chord-pattern 节奏点位 / drum-pattern)
//     .sty 格式 = 我们今后自写织体的模板规则。
//   - voicing 美学(drop2 / 宽排 / voice-leading)仍走 mg/我们的 generateVoicing,
//     IMP chord-pattern 只决定「何时弹、弹什么功能」,排列交给 voicing 层。
//   - LOFI:IMP 无真 lofi → 留用 mg 织体(source='mg')。
// ============================================================

export type MacroStyle = 'POP' | 'JAZZ' | 'RNB' | 'LOFI' | 'BLUES';

export interface StyleRoute {
    /** 伴奏来源:imp=用 IMP .sty 三轨;mg=用 mg generateArrangement 织体 */
    source: 'imp' | 'mg';
    /** IMP style 名(source=imp 时有效)*/
    impStyle?: string;
    /** comp-swing 比(伴奏摆动;旋律用 melodySwing)。0.5=直,0.67=三连摇摆 */
    compSwing: number;
    /** 旋律摆动比 */
    melodySwing: number;
    /** 是否用延音踏板:JAZZ/BLUES 不踩(靠断奏/walking),其余踩(参考 mg generatePedalEvents)*/
    usePedal: boolean;
    /** 一句话说明 */
    note: string;
}

/** macro 风格 → 路由。改这里即换整套伴奏风格(三轨同源)。 */
export const STYLE_ROUTES: Record<MacroStyle, StyleRoute> = {
    POP:   { source: 'imp', impStyle: 'rock-medium-even', compSwing: 0.5,  melodySwing: 0.5,  usePedal: true,  note: 'straight-8 + backbeat 鼓' },
    JAZZ:  { source: 'imp', impStyle: 'swing', compSwing: 0.67, melodySwing: 0.67, usePedal: false, note: 'swing 0.67 + walking;不踩踏板(靠断奏)' },
    RNB:   { source: 'imp', impStyle: 'rhythm-and-blues', compSwing: 0.5,  melodySwing: 0.5,  usePedal: true,  note: 'funk/soul 切分' },
    BLUES: { source: 'imp', impStyle: 'shuffle',          compSwing: 0.55, melodySwing: 0.67, usePedal: false, note: 'shuffle;不踩踏板' },
    LOFI:  { source: 'mg',                                compSwing: 0.5,  melodySwing: 0.5,  usePedal: true,  note: 'IMP 无真 lofi → mg 宽排织体,踩踏板' },
};

/** mg StyleName 字符串 → 我们的 MacroStyle(songSource 的 label 里有 style)。 */
export function macroFromMgStyle(mg: string): MacroStyle {
    const s = mg.toUpperCase();
    if (s.includes('JAZZ')) return 'JAZZ';
    if (s.includes('BLUES')) return 'BLUES';
    if (s.includes('RNB') || s.includes('R&B') || s.includes('SOUL') || s.includes('FUNK')) return 'RNB';
    if (s.includes('LOFI') || s.includes('LO-FI')) return 'LOFI';
    return 'POP';
}

export function routeFor(macro: MacroStyle): StyleRoute {
    return STYLE_ROUTES[macro];
}
