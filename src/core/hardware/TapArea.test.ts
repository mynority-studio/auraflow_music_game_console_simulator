import { describe, expect, it } from 'vitest';

import { KEYBOARD_MAP, PANEL_HOTKEY_PAD_KEYS, isPanelHotkeyPadChord } from './TapArea';

describe('core/hardware/TapArea keyboard mapping', () => {
  it('maps 3x5 pads in reading order to ERTYU/DFGHJ/CVBNM', () => {
    const rows = [
      ['e', 'r', 't', 'y', 'u'],
      ['d', 'f', 'g', 'h', 'j'],
      ['c', 'v', 'b', 'n', 'm'],
    ];

    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        expect(KEYBOARD_MAP[rows[r][c]]).toEqual({ c, r });
      }
    }
  });

  it('removes the old QWERT/ASDFG/ZXCVB pad anchors', () => {
    expect(KEYBOARD_MAP.q).toBeUndefined();
    expect(KEYBOARD_MAP.w).toBeUndefined();
    expect(KEYBOARD_MAP.a).toBeUndefined();
    expect(KEYBOARD_MAP.s).toBeUndefined();
    expect(KEYBOARD_MAP.x).toBeUndefined();
    expect(KEYBOARD_MAP.z).toBeUndefined();
  });

  it('suppresses mapped panel hotkey chords while Q is held', () => {
    expect([...PANEL_HOTKEY_PAD_KEYS].sort()).toEqual(['h', 'n', 'r', 't']);

    const heldQ = new Set(['q']);
    expect(isPanelHotkeyPadChord('t', heldQ)).toBe(true);
    expect(isPanelHotkeyPadChord('r', heldQ)).toBe(true);
    expect(isPanelHotkeyPadChord('h', heldQ)).toBe(true);
    expect(isPanelHotkeyPadChord('n', heldQ)).toBe(true);

    expect(isPanelHotkeyPadChord('t', new Set())).toBe(false);
    expect(isPanelHotkeyPadChord('e', heldQ)).toBe(false);
    expect(isPanelHotkeyPadChord('q', heldQ)).toBe(false);
  });
});
