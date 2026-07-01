import { describe, expect, it } from 'vitest';

import {
  ENABLE_AURABAR_MENU_GESTURES,
  ENABLE_SYSTEM_MENU_GESTURES,
  menuGesturesEnabled,
} from './menuGestureGuards';

describe('core/hardware/menuGestureGuards', () => {
  it('keeps menu gestures paused while lead takeover pad tests are active', () => {
    expect(ENABLE_SYSTEM_MENU_GESTURES).toBe(false);
    expect(ENABLE_AURABAR_MENU_GESTURES).toBe(false);
    expect(menuGesturesEnabled('system')).toBe(false);
    expect(menuGesturesEnabled('aurabar')).toBe(false);
  });
});
