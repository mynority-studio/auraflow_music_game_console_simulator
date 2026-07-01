// Temporary guard while the lead takeover sandbox owns TAP AREA testing.
// Re-enable these only when menu gestures no longer conflict with pad input tests.
export const ENABLE_SYSTEM_MENU_GESTURES = false;
export const ENABLE_AURABAR_MENU_GESTURES = false;

export function menuGesturesEnabled(scope: 'system' | 'aurabar'): boolean {
  return scope === 'system' ? ENABLE_SYSTEM_MENU_GESTURES : ENABLE_AURABAR_MENU_GESTURES;
}
