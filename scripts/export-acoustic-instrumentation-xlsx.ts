import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  ACOUSTIC_SUBSET_RELEASES,
  ACOUSTIC_TEMPLATE_VOICES,
  type AcousticMelodicVoiceAddress,
} from '../src/core/generation/newEngine/instrumental/acousticDebugPalette';
import { ACOUSTIC_INSTRUMENTATION_PROFILES } from '../src/core/generation/newEngine/arranger/acousticInstrumentationProfiles';

type Cell = string | number;
type Row = Cell[];

const root = process.cwd();
const outPath = resolve(root, 'docs/generated/Dream5504_Acoustic_Orchestration_Usage.xlsx');
const tsvPath = resolve(root, 'components/samvs/DREAM_SDK_20250802/Free_Sounds/GMBK5X128_SoundBank/GMBK5X128_Midi.tsv');

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

function sheetXml(rows: readonly Row[], widths: readonly number[], freezeHeader = true): string {
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  const data = rows.map((row, rowIndex) => {
    const style = rowIndex === 0 ? 1 : 0;
    return `<row r="${rowIndex + 1}">${row.map((value, index) => cellXml(value, index, rowIndex + 1, style)).join('')}</row>`;
  }).join('');
  const lastColumn = columnName(Math.max(0, widths.length - 1));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>${columns}</cols>
  ${freezeHeader ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : ''}
  <sheetData>${data}</sheetData>
  <autoFilter ref="A1:${lastColumn}${rows.length}"/>
</worksheet>`;
}

function parseGmbkNames(): Map<string, string> {
  const tsv = readFileSync(tsvPath, 'utf8');
  const names = new Map<string, string>();
  for (const line of tsv.split(/\r?\n/)) {
    const programMatch = line.match(/^\s*(\d{1,3}):\s*([^\t]+)/);
    if (!programMatch) continue;
    const program = Number(programMatch[1]);
    names.set(`0/${program}`, programMatch[2].trim());
    const variations = /\(,(\d+)\):\s*([^\t]+)/g;
    let variation: RegExpExecArray | null;
    while ((variation = variations.exec(line))) names.set(`${variation[1]}/${program}`, variation[2].trim());
  }
  names.set('8/25', '12 String Guitar');
  return names;
}

function parseDrumNames(): Map<number, string> {
  const lines = readFileSync(tsvPath, 'utf8').split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes('Standard Drum EQ') && line.includes('CM Drum-X'));
  const names = new Map<number, string>();
  if (index < 0) return names;
  const labels = lines[index].split('\t').map((value) => value.trim()).filter(Boolean);
  const pcLine = lines.slice(index + 1).find((line) => line.includes('Pc:')) ?? '';
  const programs = [...pcLine.matchAll(/Pc:\s*(\d+)/g)].map((match) => Number(match[1]));
  programs.forEach((program, itemIndex) => names.set(program, labels[itemIndex] ?? `Drum Kit PC${program}`));
  return names;
}

function familyForSubset(id: string): readonly [string, string] {
  if (id.includes('piano')) return ['原声键盘', '原声钢琴'];
  if (id.includes('bass')) return ['原声低音', '原声 Bass'];
  if (id.includes('bowed') || id.includes('solo-bowed')) return ['原声弦乐', '弓弦'];
  if (id.includes('plucked') || id.includes('guitar') || id.includes('world-plucked')) return ['拨弦', '拨弦/吉他'];
  if (id.includes('mallet')) return ['击槌', '击槌'];
  if (id.includes('vibraphone')) return ['击槌', '颤音琴'];
  if (id.includes('reed')) return ['簧片', '簧片'];
  if (id.includes('sax')) return ['管乐', '萨克斯'];
  if (id.includes('brass')) return ['管乐', '铜管'];
  if (id.includes('woodwind') || id.includes('wind')) return ['管乐', '木管/民族管乐'];
  if (id.includes('percussion')) return ['打击乐', '总谱点缀'];
  return ['其他', '其他'];
}

function key(voice: AcousticMelodicVoiceAddress): string {
  return `${voice.bank}/${voice.program}`;
}

const names = parseGmbkNames();
const drumNames = parseDrumNames();
const activeUsage = new Map<string, string[]>();
for (const [profileId, template] of Object.entries(ACOUSTIC_TEMPLATE_VOICES)) {
  for (const role of ['comp', 'lead', 'bass', 'pad'] as const) {
    for (const voice of template[role]) {
      const current = activeUsage.get(key(voice)) ?? [];
      current.push(`${profileId}:${role}`);
      activeUsage.set(key(voice), current);
    }
  }
}
for (const [profileId, template] of Object.entries(ACOUSTIC_TEMPLATE_VOICES)) {
  const current = activeUsage.get(`drum/${template.drumProgram}`) ?? [];
  current.push(`${profileId}:drum`);
  activeUsage.set(`drum/${template.drumProgram}`, current);
}

const overview: Row[] = [
  ['Dream 5504 原声器配审计', '数量', '说明'],
  ['当前自动调用音色地址', 17, '12 个旋律地址 + 5 套原声鼓组'],
  ['已登记但未使用地址', 85, '保持在器配注册表中，status=held'],
  ['自动编曲排除', 128, 'MT-32 CC0=127 兼容重映射不进入自动器配'],
  ['', '', ''],
  ['Arranger 原声模板', '共享钢琴角色', '编制意图'],
  ...Object.values(ACOUSTIC_INSTRUMENTATION_PROFILES).map((profile) => [
    `${profile.id} · ${profile.label}`,
    profile.sharedPianoRoles?.join(' + ') ?? '无',
    Object.entries(profile.roleSummary).map(([role, summary]) => `${role}: ${summary}`).join(' | '),
  ]),
];

const voiceRows: Row[] = [[
  '使用状态', '族', '子类/注册组', 'CC0', 'Program', '官方音色名', '可自动承担角色', 'Arranger 模板调用', '表情合同', '自动 CC', '试听 CC', '选择模式',
]];
for (const subset of ACOUSTIC_SUBSET_RELEASES) {
  const [family, subfamily] = familyForSubset(subset.id);
  for (const voice of subset.melodicVoices) {
    const usage = activeUsage.get(key(voice)) ?? [];
    voiceRows.push([
      subset.status === 'active' && usage.length ? '已使用（自动编曲）' : subset.status === 'active' ? '已释放但当前模板未调用' : '未使用（冻结）',
      family, `${subfamily} · ${subset.label}`, voice.bank, voice.program,
      names.get(key(voice)) ?? `CC0=${voice.bank} PC=${voice.program}`,
      usage.map((item) => item.split(':')[1]).join(', ') || '无',
      usage.join(' | ') || '无', subset.expression,
      subset.automaticControllers.join(', ') || '无', subset.auditionControllers.join(', ') || '无', subset.selectionMode,
    ]);
  }
  for (const program of subset.drumPrograms ?? []) {
    const usage = activeUsage.get(`drum/${program}`) ?? [];
    voiceRows.push([
      subset.status === 'active' && usage.length ? '已使用（自动编曲）' : '未使用（冻结）',
      '鼓组', subset.label, 'Channel 10', program, drumNames.get(program) ?? `Drum Kit PC${program}`,
      usage.map((item) => item.split(':')[1]).join(', ') || '无', usage.join(' | ') || '无', subset.expression,
      subset.automaticControllers.join(', ') || '无', subset.auditionControllers.join(', ') || '无', subset.selectionMode,
    ]);
  }
}

const templateRows: Row[] = [[
  '风格', 'Arranger 模板', 'Comp', 'Lead', 'Bass', 'Pad', 'Drum', '共享钢琴',
]];
for (const [profileId, template] of Object.entries(ACOUSTIC_TEMPLATE_VOICES)) {
  const profile = ACOUSTIC_INSTRUMENTATION_PROFILES[profileId as keyof typeof ACOUSTIC_INSTRUMENTATION_PROFILES];
  const voices = (items: readonly AcousticMelodicVoiceAddress[]) => items.map((voice) => `${voice.bank}/${voice.program} ${names.get(key(voice)) ?? ''}`.trim()).join(' | ');
  templateRows.push([
    profile.label, profileId, voices(template.comp), voices(template.lead), voices(template.bass), voices(template.pad),
    `${template.drumProgram} ${drumNames.get(template.drumProgram) ?? ''}`.trim(), template.sharedPianoRoles?.join(' + ') ?? '无',
  ]);
}

const temp = mkdtempSync(join(tmpdir(), 'aura-xlsx-'));
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
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="总览" sheetId="1" r:id="rId1"/><sheet name="音色清单" sheetId="2" r:id="rId2"/><sheet name="模板与轨道" sheetId="3" r:id="rId3"/></sheets></workbook>`);
  writeFileSync(join(temp, 'xl', '_rels', 'workbook.xml.rels'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  writeFileSync(join(temp, 'xl', 'styles.xml'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`);
  writeFileSync(join(temp, 'xl', 'worksheets', 'sheet1.xml'), sheetXml(overview, [34, 22, 110], false));
  writeFileSync(join(temp, 'xl', 'worksheets', 'sheet2.xml'), sheetXml(voiceRows, [22, 16, 40, 10, 11, 34, 22, 64, 54, 12, 12, 22]));
  writeFileSync(join(temp, 'xl', 'worksheets', 'sheet3.xml'), sheetXml(templateRows, [24, 26, 40, 52, 34, 54, 24, 26]));
  execFileSync('zip', ['-q', '-r', outPath, '.'], { cwd: temp });
  console.log(`Wrote ${outPath}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
