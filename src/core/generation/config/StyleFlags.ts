export enum StyleId {
    ModernPop = 0,
    ClassicJPop = 1,
    ModernJPop = 2,
    DarkPop = 3,
    PopRock = 4,
    IndieRock = 5,
    PostRock = 6,
    Eurodance = 7,
    Trance = 8,
    Synthwave = 9,
    PowerBallad = 10,
    RussianFolkBallad = 11,
    GhibliOrchestral = 12,
    ProgressiveHouse = 13,
    LofiHipHop = 14,
    NeoSoul = 15,
    Lofi = 16,
    SmoothJazz = 17,
    BossaNova = 18
}

// ★ 风格分类位掩码 — 替代全部 style.id.includes() 子串匹配
export const StyleFlag = {
  IS_ELECTRONIC : 1 << 0,
  IS_ACOUSTIC   : 1 << 1,
  IS_ORCHESTRAL : 1 << 2,
  IS_ROCK       : 1 << 3,
  IS_JAZZ       : 1 << 4,
  IS_BALLAD     : 1 << 5,
  HAS_SWING     : 1 << 6,
  HAS_TRIPLET   : 1 << 7,
} as const;

// 查表方式：StyleFlagTable[StyleId.Lofi] → number
// if (StyleFlagTable[styleId] & StyleFlag.IS_ELECTRONIC) { ... }
const _E = StyleFlag.IS_ELECTRONIC;
const _A = StyleFlag.IS_ACOUSTIC;
const _O = StyleFlag.IS_ORCHESTRAL;
const _R = StyleFlag.IS_ROCK;
const _J = StyleFlag.IS_JAZZ;
const _B = StyleFlag.IS_BALLAD;
const _SW = StyleFlag.HAS_SWING;
const _TR = StyleFlag.HAS_TRIPLET;

// 静态数组，以 StyleId 值为下标直接寻址（不连续处填 0）
export const StyleFlagTable: number[] = (() => {
  const t = new Array<number>(19).fill(0);
  t[StyleId.ModernPop]          = _A;
  t[StyleId.ClassicJPop]        = _A;
  t[StyleId.ModernJPop]         = _A | _E;
  t[StyleId.DarkPop]            = _E;
  t[StyleId.PopRock]            = _R;
  t[StyleId.IndieRock]          = _R;
  t[StyleId.PostRock]           = _R;
  t[StyleId.Eurodance]          = _E;
  t[StyleId.Trance]             = _E;
  t[StyleId.Synthwave]          = _E;
  t[StyleId.PowerBallad]        = _B | _R;
  t[StyleId.RussianFolkBallad]  = _B | _A;
  t[StyleId.GhibliOrchestral]   = _O;
  t[StyleId.ProgressiveHouse]   = _E;
  t[StyleId.LofiHipHop]         = _E | _J | _SW;
  t[StyleId.NeoSoul]            = _J | _SW;
  t[StyleId.Lofi]               = _E | _J | _SW;
  t[StyleId.SmoothJazz]         = _J | _SW;
  t[StyleId.BossaNova]          = _J | _A | _SW;
  return t;
})();

export const StyleIdName: Record<StyleId, string> = {
    [StyleId.ModernPop]: '现代华语流行 (Modern C-Pop)',
    [StyleId.ClassicJPop]: '昭和经典流行 (Classic J-Pop)',
    [StyleId.ModernJPop]: '现代日系流行 (Modern J-Pop)',
    [StyleId.DarkPop]: '暗黑流行 (Dark Pop)',
    [StyleId.PopRock]: '流行摇滚 (Pop Rock)',
    [StyleId.IndieRock]: '独立摇滚 (Indie Rock)',
    [StyleId.PostRock]: '后摇滚 (Post-Rock)',
    [StyleId.Eurodance]: '欧洲舞曲 (Eurodance)',
    [StyleId.Trance]: 'Trance 舞曲',
    [StyleId.Synthwave]: '合成器浪潮 (Synthwave)',
    [StyleId.PowerBallad]: '力量抒情 (Power Ballad)',
    [StyleId.RussianFolkBallad]: '俄罗斯民谣抒情 (Russian Folk Ballad)',
    [StyleId.GhibliOrchestral]: '吉卜力管弦乐 (Ghibli Orchestral)',
    [StyleId.ProgressiveHouse]: '前卫浩室 (Progressive House)',
    [StyleId.LofiHipHop]: '低保真嘻哈 (Lo-Fi Hip Hop)',
    [StyleId.NeoSoul]: '新灵魂乐 (Neo-Soul)',
    [StyleId.Lofi]: '低保真 (Lo-Fi)',
    [StyleId.SmoothJazz]: '平滑爵士 (Smooth Jazz)',
    [StyleId.BossaNova]: '巴萨诺瓦 (Bossa Nova)'
};
