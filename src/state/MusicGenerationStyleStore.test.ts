import { describe, expect, it } from 'vitest';
import { musicGenStyleLabel } from './MusicGenerationStyleStore';

describe('MusicGenerationStyleStore display labels', () => {
  it('calls the ACG piano mode ACG PIANOSONG without changing its engine ID', () => {
    expect(musicGenStyleLabel('ACG')).toBe('ACG PIANOSONG');
    expect(musicGenStyleLabel('POP')).toBe('POP');
  });
});
