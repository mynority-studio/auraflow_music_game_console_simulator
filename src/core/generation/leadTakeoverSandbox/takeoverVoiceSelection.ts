import { dreamVoiceProfileFor } from '../newEngine/instrumental/dreamVoiceProfiles';

export interface TakeoverLeadVoiceSelection {
  bank?: number;
  program: number;
}

let selectedVoice: TakeoverLeadVoiceSelection | null = null;

export function getTakeoverLeadVoiceSelection(): TakeoverLeadVoiceSelection | null {
  return selectedVoice ? { ...selectedVoice } : null;
}

export function setTakeoverLeadVoiceSelection(
  selection: TakeoverLeadVoiceSelection,
): TakeoverLeadVoiceSelection {
  const profile = dreamVoiceProfileFor({
    role: 'lead',
    bank: selection.bank ?? 0,
    program: selection.program,
  });
  if (!profile
      || profile.arrangementStatus !== 'available'
      || !profile.roleCapabilities.includes('lead')) {
    throw new RangeError(
      `Dream 5504 voice is not available for takeover Lead: CC0=${selection.bank ?? 0}, PC=${selection.program}`,
    );
  }
  selectedVoice = {
    bank: profile.address.bank ?? 0,
    program: profile.address.program,
  };
  return { ...selectedVoice };
}

export function clearTakeoverLeadVoiceSelection(): void {
  selectedVoice = null;
}
