// ============================================================
// duration-parser.ts — Impro-Visor 时值 token 解析
// ============================================================
//
// Lead sheet 时值约定:
//   '4'    quarter        = 1.0 beat
//   '8'    eighth         = 0.5 beat
//   '16'   sixteenth      = 0.25 beat
//   '2'    half           = 2.0 beat
//   '1'    whole          = 4.0 beat(4/4 拍号)
//
// 修饰:
//   '4.'    dotted quarter = 1.5 beat
//   '4+8'   tied  quarter+eighth = 1.5 beat(任意 + 合成)
//   '8/3'   eighth triplet = 0.333 beat(`n/3` = 4/n × 2/3)
//   '4/3'   quarter triplet = 0.666 beat
//
// 复合:'4+8+16' = 1.75, '4.+8' = 2.0(dotted quarter + eighth)
//
// 输出:beat 数(float)。无法解析 → 0(caller 跳过此 token)。
// ============================================================

export function parseDurationBeats(s: string): number {
  if (!s) return 0;
  let total = 0;
  for (const part of s.split('+')) {
    total += parseSingle(part);
  }
  return total;
}

function parseSingle(raw: string): number {
  if (!raw) return 0;
  let work = raw;
  let dotted = false;
  if (work.endsWith('.')) {
    dotted = true;
    work = work.slice(0, -1);
  }
  let beats: number;
  if (work.includes('/')) {
    const slashIdx = work.indexOf('/');
    const num = parseInt(work.slice(0, slashIdx), 10);
    const div = parseInt(work.slice(slashIdx + 1), 10);
    if (isNaN(num) || isNaN(div) || num <= 0 || div <= 0) return 0;
    beats = (4 / num) * (2 / div);
  } else {
    const n = parseInt(work, 10);
    if (isNaN(n) || n <= 0) return 0;
    beats = 4 / n;
  }
  if (dotted) beats *= 1.5;
  return beats;
}
