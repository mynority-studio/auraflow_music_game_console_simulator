// ============================================================
// ImproCore engine — Duration
// imp/data/Duration.java getDuration() 的忠实移植
// ============================================================
//
// leadsheet 时值串 → slot 数。base = WHOLE(480)。
//   "8"      → 480/8        = 60   (八分)
//   "4"      → 480/4        = 120  (四分)
//   "4."     → 120 + 60     = 180  (附点四分)
//   "8/3"    → 480*2/(8*3)  = 40   (八分三连音)
//   "2.+8/3+32" → 加法组合
// 无前导数字 → DEFAULT_DURATION。
// ============================================================

import { WHOLE, DEFAULT_DURATION } from './constants';

const isDigit = (c: string): boolean => c >= '0' && c <= '9';

export function getDuration(item: string): number {
    const len = item.length;
    let index = 0;
    if (len === 0 || !isDigit(item.charAt(index))) {
        return DEFAULT_DURATION;
    }

    // 整串若解析为 0 → 时值 0
    const whole = parseInt(item, 10);
    if (whole === 0) return 0;

    let duration = 0;
    let firsttime = true;

    while (index < len && (item.charAt(index) === '+' || firsttime || item.charAt(index) === 'u')) {
        let numerator: number;
        let denominator = 1;

        if (firsttime) {
            firsttime = false;       // 无前导 +
        } else {
            index++;                 // 跳过中缀 +
        }

        let hasDigit = false;
        let dur = '';
        while (index < len && isDigit(item.charAt(index))) {
            hasDigit = true;
            dur += item.charAt(index);
            index++;
        }
        numerator = hasDigit ? parseInt(dur, 10) : 8; // default_numerator = 8

        let slots = WHOLE;

        // 连音 /N
        if (index < len && item.charAt(index) === '/') {
            index++;
            if (index >= len || !isDigit(item.charAt(index))) {
                return DEFAULT_DURATION;
            }
            let tuplet = '';
            while (index < len && isDigit(item.charAt(index))) {
                tuplet += item.charAt(index);
                index++;
            }
            denominator = parseInt(tuplet, 10);
        }

        if (denominator > 1) {
            slots *= (denominator - 1);
        }

        let thisDuration = Math.floor(slots / (numerator * denominator));

        // 附点
        let increment = thisDuration;
        while (index < len && item.charAt(index) === '.') {
            increment = Math.floor(increment / 2);
            thisDuration += increment;
            index++;
        }

        duration += thisDuration;
    }

    if (duration <= 0) duration = DEFAULT_DURATION;
    return duration;
}

export function getDuration0(item: string): number {
    return item.trim() === '' ? 0 : getDuration(item);
}

/** Duration.isDuration:是否合法时值串(首字符为数字即可,覆盖 "8"/"16/3"/"2+4"/"4.") */
export function isDuration(item: string): boolean {
    return item.length > 0 && isDigit(item.charAt(0));
}

// ------------------------------------------------------------
// 反向:slot → leadsheet 串(仅显示/调试用,非 Note.getDurationString 的完整复刻)
// ------------------------------------------------------------

const COMMON: ReadonlyArray<[number, string]> = [
    [480, '1'], [360, '2.'], [240, '2'], [180, '4.'], [120, '4'],
    [90, '8.'], [60, '8'], [40, '8/3'], [30, '16'], [20, '16/3'], [15, '32'],
];

export function durationToString(slots: number): string {
    for (const [v, s] of COMMON) {
        if (slots === v) return s;
    }
    // 退化:用八分为单位近似
    return String(Math.max(1, Math.round(slots / 60))) + '?';
}
