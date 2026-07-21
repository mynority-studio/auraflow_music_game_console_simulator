// ============================================================
// newEngine · arranger · acoustic instrumentation profiles
// ------------------------------------------------------------
// Arranger owns the musical ensemble identity. Instrumental later maps this
// intent to audited Dream CC0 + Program addresses; it must not infer a band
// merely from a style name after the score has been issued.
// ============================================================

import type { InstrumentRoleName } from '../band/BandSpec';

export type AcousticInstrumentationProfileId =
  | 'pop-piano-strings'
  | 'jazz-piano-trio'
  | 'lofi-piano-small-group'
  | 'rnb-piano-strings'
  | 'acg-piano-solo';

export interface AcousticInstrumentationIntent {
  id: AcousticInstrumentationProfileId;
  label: string;
  /** Roles this score treats as one physical piano player, when applicable. */
  sharedPianoRoles?: readonly InstrumentRoleName[];
  /** Human-auditable score ownership. It does not select MIDI programs itself. */
  roleSummary: Readonly<Partial<Record<InstrumentRoleName, string>>>;
}

export const ACOUSTIC_INSTRUMENTATION_PROFILES: Readonly<Record<AcousticInstrumentationProfileId, AcousticInstrumentationIntent>> = {
  'pop-piano-strings': {
    id: 'pop-piano-strings',
    label: 'POP 钢琴弦乐团',
    roleSummary: {
      comp: '原声钢琴和声', lead: '钢琴或独奏弓弦主题', bass: '原声 Bass 或低音提琴',
      pad: '合奏弦乐床', drum: 'Room 原声鼓组',
    },
  },
  'jazz-piano-trio': {
    id: 'jazz-piano-trio',
    label: 'JAZZ 钢琴三重奏',
    sharedPianoRoles: ['lead', 'comp'],
    roleSummary: {
      comp: '钢琴左/中声部', lead: '同一架钢琴右手主题/即兴', bass: '原声 Bass', drum: 'Brush 鼓组',
    },
  },
  'lofi-piano-small-group': {
    id: 'lofi-piano-small-group',
    label: 'LOFI 钢琴小组',
    roleSummary: {
      comp: '原声钢琴循环和声', lead: '钢琴主题碎片', bass: '原声 Bass',
      pad: '低密度弦乐床', drum: 'Standard 原声鼓组',
    },
  },
  'rnb-piano-strings': {
    id: 'rnb-piano-strings',
    label: 'RNB 钢琴弦乐小组',
    roleSummary: {
      comp: '原声钢琴和声', lead: '钢琴或大提琴主题', bass: '原声 Bass 或低音提琴',
      pad: '合奏弦乐床', drum: 'Room 原声鼓组',
    },
  },
  'acg-piano-solo': {
    id: 'acg-piano-solo',
    label: 'ACG 纯钢琴',
    sharedPianoRoles: ['lead', 'comp', 'bass'],
    roleSummary: {
      bass: '同一架钢琴左手低音', comp: '同一架钢琴中部和声', lead: '同一架钢琴右手旋律',
    },
  },
};

export function acousticInstrumentationIntentForStyle(style: string): AcousticInstrumentationIntent | undefined {
  switch (style.toLowerCase()) {
    case 'pop': return ACOUSTIC_INSTRUMENTATION_PROFILES['pop-piano-strings'];
    case 'jazz': return ACOUSTIC_INSTRUMENTATION_PROFILES['jazz-piano-trio'];
    case 'lofi': return ACOUSTIC_INSTRUMENTATION_PROFILES['lofi-piano-small-group'];
    case 'rnb': return ACOUSTIC_INSTRUMENTATION_PROFILES['rnb-piano-strings'];
    case 'acg': return ACOUSTIC_INSTRUMENTATION_PROFILES['acg-piano-solo'];
    default: return undefined;
  }
}
