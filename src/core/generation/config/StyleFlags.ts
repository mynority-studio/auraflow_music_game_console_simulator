export enum StyleId {
    ModernPop = 0,
    ClassicJPop = 1,
    ModernJPop = 2,
    PopRock = 4,
    Eurodance = 7,
    Trance = 8,
    Synthwave = 9,
    PowerBallad = 10,
    RussianFolkBallad = 11,
    GhibliOrchestral = 12,
    Lofi = 16
}

export const StyleIdName: Record<StyleId, string> = {
    [StyleId.ModernPop]: '现代华语流行 (Modern C-Pop)',
    [StyleId.ClassicJPop]: '昭和经典流行 (Classic J-Pop)',
    [StyleId.ModernJPop]: '现代日系流行 (Modern J-Pop)',
    [StyleId.PopRock]: '流行摇滚 (Pop Rock)',
    [StyleId.Eurodance]: '欧洲舞曲 (Eurodance)',
    [StyleId.Trance]: 'Trance 舞曲',
    [StyleId.Synthwave]: '合成器浪潮 (Synthwave)',
    [StyleId.PowerBallad]: '力量抒情 (Power Ballad)',
    [StyleId.RussianFolkBallad]: '俄罗斯民谣抒情 (Russian Folk Ballad)',
    [StyleId.GhibliOrchestral]: '吉卜力管弦乐 (Ghibli Orchestral)',
    [StyleId.Lofi]: '低保真嘻哈 (Lo-Fi Hip Hop)'
};
