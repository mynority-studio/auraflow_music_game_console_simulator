import { afterEach, describe, expect, it } from 'vitest';
import { dreamVoiceProfilesForRole } from '../newEngine/instrumental/dreamVoiceProfiles';
import {
  clearTakeoverLeadVoiceSelection,
  getTakeoverLeadVoiceSelection,
  setTakeoverLeadVoiceSelection,
} from './takeoverVoiceSelection';

describe('leadTakeoverSandbox/takeoverVoiceSelection', () => {
  afterEach(() => clearTakeoverLeadVoiceSelection());

  it('stores a complete modern Dream address that the Lead role can carry', () => {
    const voice = dreamVoiceProfilesForRole('lead').find((candidate) => candidate.address.bank !== undefined);
    expect(voice).toBeTruthy();

    expect(setTakeoverLeadVoiceSelection({
      bank: voice!.address.bank,
      program: voice!.address.program,
    })).toEqual({
      bank: voice!.address.bank ?? 0,
      program: voice!.address.program,
    });
    expect(getTakeoverLeadVoiceSelection()).toEqual({
      bank: voice!.address.bank ?? 0,
      program: voice!.address.program,
    });
  });

  it('rejects a Dream address that is not available to the Lead role', () => {
    const bassOnly = dreamVoiceProfilesForRole('bass')
      .find((candidate) => !candidate.roleCapabilities.includes('lead'));
    expect(bassOnly).toBeTruthy();

    expect(() => setTakeoverLeadVoiceSelection({
      bank: bassOnly!.address.bank,
      program: bassOnly!.address.program,
    })).toThrow(/not available for takeover Lead/);
  });
});
