import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';

import type { dreamVoiceCcProfile as DreamVoiceCcProfile } from '../src/core/generation/newEngine/instrumental/dreamCcCapabilities';
import type {
  DreamCcExpressionContract,
  DreamGestureSubfamily,
  DreamInstrumentClass,
  DreamPlayingMechanism,
  DreamSoundSource,
  DreamVoiceProfile,
} from '../src/core/generation/newEngine/instrumental/dreamVoiceProfiles';

type Cell = string | number;
type Row = Cell[];

const root = process.cwd();
const outPath = resolve(root, 'docs/generated/Dream5504_GMBK5X128_Performance_Classification.xlsx');
const markdownOutPath = resolve(root, 'docs/generated/Dream5504_CC_Expression_Contract_Mapping.md');

type RegistryModule = Pick<typeof import('../src/core/generation/newEngine/instrumental/dreamVoiceProfiles'),
  | 'DREAM5504_FULL_AUDITION_VOICE_PROFILES'
  | 'DREAM5504_MODERN_MELODIC_VOICE_COUNT'
  | 'DREAM5504_MT32_COMPATIBILITY_VOICE_COUNT'
  | 'DREAM_CC_EXPRESSION_CONTRACTS'>;
type CapabilityModule = { dreamVoiceCcProfile: typeof DreamVoiceCcProfile };

// The authoritative catalog is a Vite ?raw TSV import. Load it through Vite
// here too so this audit export consumes precisely the same registry as the app.
const vite = await createServer({
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
});
let registry: RegistryModule;
let capabilities: CapabilityModule;
try {
  registry = await vite.ssrLoadModule('/src/core/generation/newEngine/instrumental/dreamVoiceProfiles.ts') as RegistryModule;
  capabilities = await vite.ssrLoadModule('/src/core/generation/newEngine/instrumental/dreamCcCapabilities.ts') as CapabilityModule;
} finally {
  await vite.close();
}

const {
  DREAM5504_FULL_AUDITION_VOICE_PROFILES,
  DREAM5504_MODERN_MELODIC_VOICE_COUNT,
  DREAM5504_MT32_COMPATIBILITY_VOICE_COUNT,
  DREAM_CC_EXPRESSION_CONTRACTS,
} = registry;
const { dreamVoiceCcProfile } = capabilities;

const xml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function columnName(index: number): string {
  let value = index + 1;
  let out = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    out = String.fromCharCode(65 + remainder) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}

function cellXml(value: Cell, index: number, row: number, style = 0): string {
  const ref = `${columnName(index)}${row}`;
  if (typeof value === 'number') return `<c r="${ref}" s="${style}" t="n"><v>${value}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
}

function sheetXml(rows: readonly Row[], widths: readonly number[]): string {
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  const data = rows.map((row, rowIndex) => {
    const style = rowIndex === 0 ? 1 : 0;
    return `<row r="${rowIndex + 1}">${row.map((value, index) => cellXml(value, index, rowIndex + 1, style)).join('')}</row>`;
  }).join('');
  const lastColumn = columnName(Math.max(0, widths.length - 1));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>${columns}</cols>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetData>${data}</sheetData>
  <autoFilter ref="A1:${lastColumn}${rows.length}"/>
</worksheet>`;
}

const playingMechanismLabel: Record<DreamPlayingMechanism, string> = {
  keybed: '弹奏（键盘）', 'bellows-keybed': '风箱键盘', 'blown-wind': '吹奏',
  'plucked-string': '弹拨', 'bowed-string': '弓弦', struck: '击奏',
  'drum-kit': '鼓组', effect: '效果/事件',
};

const instrumentClassLabel: Record<DreamInstrumentClass, string> = {
  'acoustic-piano': '原声钢琴', 'electric-piano': '电钢琴', 'synth-keyboard': '合成器键盘',
  'acoustic-keyed-pluck': '原声键控拨弦', 'electric-keyed-pluck': '电声键控拨弦', 'electric-organ': '电风琴',
  accordion: '手风琴/班多钮', harmonica: '口琴', vibraphone: '颤音琴', 'mallet-percussion': '击槌乐器',
  'acoustic-guitar': '原声吉他', 'electric-guitar': '电吉他',
  'acoustic-guitar-harmonics': '原声吉他泛音', 'electric-guitar-harmonics': '电吉他泛音',
  'acoustic-bass': '原声 Bass', 'electric-bass': '电 Bass', 'synth-bass': '合成 Bass', 'organ-bass': '风琴 Bass',
  'bowed-solo-string': '独奏弓弦', 'bowed-ensemble-string': '弦乐组', 'orchestral-plucked-string': '管弦拨弦',
  harp: '竖琴', 'world-plucked-string': '民族拨弦', 'thumb-piano': '卡林巴/拇指琴',
  brass: '铜管', saxophone: '萨克斯', 'single-reed-woodwind': '单簧木管', 'double-reed-woodwind': '双簧木管',
  'air-reed-woodwind': '空气簧片木管', bagpipe: '风笛', 'world-double-reed': '民族双簧吹管',
  'choir-voice': '合唱人声', 'pitched-percussion': '有音高打击', 'orchestral-percussion': '管弦打击',
  'drum-kit': '鼓组', effect: '效果音/事件',
};

const soundSourceLabel: Record<DreamSoundSource, string> = {
  acoustic: '原生', electric: '电声', synth: '合成', hybrid: '混合', effect: '效果',
};

const ccExpressionContractLabel: Record<DreamCcExpressionContract, string> = {
  'piano-damper': '钢琴延音',
  'continuous-acoustic': '连续声学',
  'keyed-sustain': '键控持续',
  'electronic-keybed': '电声键盘',
  'plucked-struck': '弹拨/击打',
  drum: '鼓组',
};

const ccExpressionContractScope: Record<DreamCcExpressionContract, string> = {
  'piano-damper': '原声钢琴；未来由 PedalPlan 决定 CC64 与 CC11。',
  'continuous-acoustic': '吹管、弓弦、口琴、风笛；不继承钢琴 CC64。',
  'keyed-sustain': '风琴、手风琴/班多钮、风琴 Bass；本轮不自动下发 CC。',
  'electronic-keybed': '电钢、Clav、合成键盘/Pad/Bass、人声采样；本轮不自动下发 CC。',
  'plucked-struck': '吉他与泛音、Bass、键控拨弦、击槌/拨弦打击；由音符、速度、时值塑形。',
  drum: 'Channel 10 鼓组；由鼓音符映射、时值与力度塑形，不走通道表情 CC。',
};

const subfamilyLabel: Record<DreamGestureSubfamily, string> = {
  'hammered-piano-damper': '击槌钢琴与延音踏板', 'electric-piano-keybed': '电钢琴触键与自然 release',
  'keyed-pluck': '键控拨弦', 'organ-keyhold': '风琴按键持续', 'accordion-bellows-keyhold': '手风琴/班多钮风箱持续',
  'harmonica-breath': '口琴吹吸簧片',
  'vibraphone-damper': '颤音琴击槌与制音', 'mallet-strike': '普通击槌衰减',
  'fretted-pluck': '普通品弦拨奏', 'fretted-muted': '闷音品弦拨奏', 'fretted-slide': '滑棒/夏威夷吉他',
  'guitar-harmonics': '吉他泛音', 'bass-fingered-pluck': '指弹/无品 Bass', 'bass-picked-pluck': '拨片 Bass',
  'bass-slap': 'Slap Bass', 'bass-synth': '合成 Bass', 'bass-organ-sustain': '风琴 Bass 持续',
  'bowed-solo-string': '独奏弓弦', 'bowed-contrabass': '低音提琴换弓', 'bowed-ensemble-string': '弦乐组持续',
  'bowed-tremolo-ensemble': '弦乐组 tremolo', 'bowed-slow-ensemble': '慢起音弦乐组',
  'orchestral-pizzicato': '管弦 pizzicato/拨弦', 'harp-pluck': '竖琴拨弦', 'world-plucked-string': '民族拨弦', 'thumb-pluck': '拇指琴拨片',
  'brass-breath': '铜管气息', 'sax-breath': '萨克斯连续气息', 'single-reed-breath': '单簧木管气息',
  'double-reed-breath': '双簧木管气息', 'flute-breath': '空气簧片木管气息',
  'world-double-reed-breath': '民族双簧吹管气息', 'bagpipe-drone': '风笛气囊与持续 Drone',
  'synth-lead-keybed': '合成 Lead 触键', 'synth-pad-sustain': '合成 Pad 持续', 'choir-sustain': '人声 Pad 持续',
  'pitched-strike': '有音高敲击', 'score-percussion': '总谱打击事件',
  'drum-acoustic-kit': '标准/Room/Power 鼓手法', 'drum-electronic-kit': '电子鼓手法', 'drum-808-kit': '808 鼓机手法',
  'drum-jazz-kit': 'Jazz 鼓手法', 'drum-brush-kit': 'Brush 鼓刷手法', 'drum-orchestral-kit': '管弦打击总谱',
  'drum-sfx-kit': '效果鼓组', 'drum-cm-kit': '兼容鼓组', 'effect-event': '效果/一次性事件',
};

function addressLabel(profile: DreamVoiceProfile): string {
  if (profile.addressSpace === 'drum-kit') return `Channel 10 · PC${profile.address.program}`;
  return `CC0=${profile.address.bank ?? 0} · PC${profile.address.program}`;
}

function addressSpaceLabel(profile: DreamVoiceProfile): string {
  if (profile.addressSpace === 'modern-gm') return '现代 GM / 允许器配候选';
  if (profile.addressSpace === 'drum-kit') return 'Channel 10 鼓组';
  return 'CC0=127 MT-32 兼容 / 仅试听';
}

function statusLabel(profile: DreamVoiceProfile): string {
  if (profile.arrangementStatus === 'available') return '已登记，可供未来 palette 释放';
  if (profile.arrangementStatus === 'manual-only') return '仅总谱事件/人工指定';
  return '仅试听，禁止自动器配';
}

function ccSummary(profile: DreamVoiceProfile): string {
  if (profile.arrangementStatus === 'audition-only') return '禁自动：MT-32 兼容重映射';
  const role = profile.roleCapabilities[0];
  if (!role) return '无：总谱/效果事件不自动下发 CC';
  const cc = dreamVoiceCcProfile({ bank: profile.address.bank, program: profile.address.program, role });
  const automatic = cc.automaticControllers.length ? `自动 CC${cc.automaticControllers.join(',')}` : '暂无自动 CC';
  const audition = cc.auditionControllers.length ? `；待实板试听 CC${cc.auditionControllers.join(',')}` : '';
  return `${automatic}${audition}`;
}

function contractSummary(profile: DreamVoiceProfile): string {
  if (!profile.ccExpressionContract) return '无：效果/事件，仅人工总谱';
  return `${ccExpressionContractLabel[profile.ccExpressionContract]} · ${ccExpressionContractScope[profile.ccExpressionContract]}`;
}

const profiles = [...DREAM5504_FULL_AUDITION_VOICE_PROFILES].sort((a, b) => {
  const space = a.addressSpace.localeCompare(b.addressSpace);
  if (space !== 0) return space;
  return (a.address.bank ?? -1) - (b.address.bank ?? -1) || a.address.program - b.address.program;
});

const overview: Row[] = [
  ['Dream 5504 / GMBK5X128 演奏手势分类', '数量', '说明'],
  ['完整出厂目录', profiles.length, '现代 GM、Channel 10 鼓组、CC0=127 MT-32 兼容目录'],
  ['现代 GM 旋律地址', DREAM5504_MODERN_MELODIC_VOICE_COUNT, '128 个 GM capital + 141 个非 MT-32 variation；可作为未来 palette 的来源'],
  ['专用鼓组', 10, '固定 Channel 10；按真实打法拆为标准、电子、808、Jazz、Brush、管弦、SFX、CM 子族'],
  ['MT-32 兼容地址', DREAM5504_MT32_COMPATIBILITY_VOICE_COUNT, '完整登记，仅供试听；绝不进入自动器配或自动 CC'],
  ['', '', ''],
  ['一级·演奏机制', '二级·乐器分类', '声源', 'CC 表情合同', '三级·演奏子族', '地址数 / 自动可用数'],
  ...[...new Map(profiles.map((profile) => [
    `${profile.playingMechanism}/${profile.instrumentClass}/${profile.gestureSubfamily}`, profile,
  ])).entries()]
    .map(([, profile]) => {
      const matching = profiles.filter((candidate) => (
        candidate.playingMechanism === profile.playingMechanism
        && candidate.instrumentClass === profile.instrumentClass
        && candidate.gestureSubfamily === profile.gestureSubfamily
      ));
      return [
        playingMechanismLabel[profile.playingMechanism],
        instrumentClassLabel[profile.instrumentClass],
        soundSourceLabel[profile.soundSource],
        profile.ccExpressionContract ? ccExpressionContractLabel[profile.ccExpressionContract] : '无（仅人工事件）',
        `${subfamilyLabel[profile.gestureSubfamily]} (${profile.gestureSubfamily})`,
        `${matching.length} / ${matching.filter((candidate) => candidate.arrangementStatus === 'available').length}`,
      ];
    }),
];

const voiceRows: Row[] = [[
  '地址空间', '器配资格', '一级·演奏机制', '二级·乐器分类', '声源', 'CC 表情合同', '合同说明', '三级·演奏子族', '引擎子族 ID',
  '目录音色身份', '表达 CC 类', '发声模式', '可担任轨道', '当前 CC 策略', 'CC0 Bank', 'PC (0-based)', 'MIDI 地址', '官方音色名', '来源',
]];

for (const profile of profiles) {
  voiceRows.push([
    addressSpaceLabel(profile), statusLabel(profile), playingMechanismLabel[profile.playingMechanism],
    instrumentClassLabel[profile.instrumentClass], soundSourceLabel[profile.soundSource],
    profile.ccExpressionContract ? ccExpressionContractLabel[profile.ccExpressionContract] : '无（仅人工事件）',
    contractSummary(profile), subfamilyLabel[profile.gestureSubfamily],
    profile.gestureSubfamily, profile.family, profile.expressionFamily, profile.mode,
    profile.roleCapabilities.join(', ') || '无', ccSummary(profile), profile.addressSpace === 'drum-kit' ? 'Channel 10' : profile.address.bank ?? 0,
    profile.address.program, addressLabel(profile), profile.name, profile.source,
  ]);
}

const contractRows: Row[] = [[
  'CC 表情合同', '物理演奏覆盖范围', '完整目录地址数', '未来可供器配数', '总谱/人工事件数', '仅试听地址数', '本轮状态',
]];
for (const contract of DREAM_CC_EXPRESSION_CONTRACTS) {
  const matching = profiles.filter((profile) => profile.ccExpressionContract === contract);
  contractRows.push([
    ccExpressionContractLabel[contract],
    ccExpressionContractScope[contract],
    matching.length,
    matching.filter((profile) => profile.arrangementStatus === 'available').length,
    matching.filter((profile) => profile.arrangementStatus === 'manual-only').length,
    matching.filter((profile) => profile.arrangementStatus === 'audition-only').length,
    '已完成地址匹配；未改变当前 CC 下发。',
  ]);
}
const noContractProfiles = profiles.filter((profile) => !profile.ccExpressionContract);
contractRows.push([
  '无合同（效果/事件）',
  '效果音、预制 fall、feedback 等不进入五轨自动器配，也不自动发 CC。',
  noContractProfiles.length,
  noContractProfiles.filter((profile) => profile.arrangementStatus === 'available').length,
  noContractProfiles.filter((profile) => profile.arrangementStatus === 'manual-only').length,
  noContractProfiles.filter((profile) => profile.arrangementStatus === 'audition-only').length,
  '保持人工总谱/试听边界。',
]);

const markdownTable = (rows: readonly Row[]): string => rows.map((row, index) => {
  const cells = row.map((cell) => String(cell).replace(/\|/g, '\\|'));
  if (index === 0) return `| ${cells.join(' | ')} |\n| ${cells.map(() => '---').join(' | ')} |`;
  return `| ${cells.join(' | ')} |`;
}).join('\n');

const contractMarkdown = `# Dream 5504 CC 表情合同：首轮地址匹配

生成日期：${new Date().toISOString().slice(0, 10)}

## 范围

- 完整官方目录：${profiles.length} 个可试听地址（${DREAM5504_MODERN_MELODIC_VOICE_COUNT} 个现代 GM 旋律地址、10 套 Channel 10 鼓组、${DREAM5504_MT32_COMPATIBILITY_VOICE_COUNT} 个 CC0=127 MT-32 兼容地址）。
- 本文件只完成**音色地址 -> 六类 CC 表情合同**的分类，不改动现有风格白名单、生成器的 CC 授权或实际 MIDI 下发。
- 目录身份仍由完整 \`CC0 + Program\` 决定；同一 PC 的不同 Bank 不共享分类结论。CC0=127 仍严格仅试听。

## 六类合同

${markdownTable(contractRows)}

## 审计规则

1. \`piano-damper\`：只表达“原声钢琴可使用踏板计划”的物理事实；具体是否发 CC64/CC11，继续由地址级 \`dreamCcCapabilities\` 与 Arranger 的 PedalPlan 共同授权。
2. \`continuous-acoustic\`：萨克斯、铜管、木管、弓弦、口琴、风笛与真实弦乐变体统一进入连续声学合同；它们不继承钢琴 CC64。
3. \`keyed-sustain\`、\`electronic-keybed\`、\`plucked-struck\`、\`drum\` 本轮只是安全的表情边界，不新增任何推测性的 CC 参数。
4. 吉他泛音保留 \`guitar-harmonics\` 子族，归入 \`plucked-struck\`；Guitar Feedback 等效果音没有合同，只能人工总谱事件。
5. 例如 CC0=3 / PC89 Rotary String 已按其真实弓弦身份归入 \`continuous-acoustic\`，不会因为 PC89 的 GM 默认槽位而被误作合成 Pad。

## 关联文件

- 完整逐地址审计表：\`docs/generated/Dream5504_GMBK5X128_Performance_Classification.xlsx\` 的“CC 表情合同”和“完整音色分类”工作表。
- 注册表：\`src/core/generation/newEngine/instrumental/dreamVoiceProfiles.ts\`。
- 当前实际 CC 授权：\`src/core/generation/newEngine/instrumental/dreamCcCapabilities.ts\`。
`;

const temp = mkdtempSync(join(tmpdir(), 'aura-dream-classification-'));
try {
  mkdirSync(join(temp, '_rels'));
  mkdirSync(join(temp, 'xl', '_rels'), { recursive: true });
  mkdirSync(join(temp, 'xl', 'worksheets'), { recursive: true });
  writeFileSync(join(temp, '[Content_Types].xml'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);
  writeFileSync(join(temp, '_rels', '.rels'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  writeFileSync(join(temp, 'xl', 'workbook.xml'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="总览" sheetId="1" r:id="rId1"/><sheet name="完整音色分类" sheetId="2" r:id="rId2"/><sheet name="CC 表情合同" sheetId="3" r:id="rId3"/></sheets></workbook>`);
  writeFileSync(join(temp, 'xl', '_rels', 'workbook.xml.rels'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  writeFileSync(join(temp, 'xl', 'styles.xml'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`);
  writeFileSync(join(temp, 'xl', 'worksheets', 'sheet1.xml'), sheetXml(overview, [22, 28, 12, 20, 34, 20]));
  writeFileSync(join(temp, 'xl', 'worksheets', 'sheet2.xml'), sheetXml(voiceRows, [28, 28, 18, 24, 12, 18, 48, 30, 28, 24, 20, 20, 18, 34, 14, 14, 20, 32, 14]));
  writeFileSync(join(temp, 'xl', 'worksheets', 'sheet3.xml'), sheetXml(contractRows, [20, 60, 18, 18, 18, 18, 34]));
  execFileSync('zip', ['-q', '-r', outPath, '.'], { cwd: temp });
  writeFileSync(markdownOutPath, contractMarkdown);
  console.log(`Wrote ${outPath} and ${markdownOutPath} (${profiles.length} addresses)`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
