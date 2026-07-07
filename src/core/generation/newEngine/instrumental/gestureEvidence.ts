import type { GestureEvidenceRef } from './InstrumentationPlan';

export interface GestureEvidenceSource {
  title: string;
  url: string;
  checkedAt: '2026-07-07';
  claim: string;
}

export const GESTURE_EVIDENCE_SOURCES: Record<GestureEvidenceRef, GestureEvidenceSource> = {
  'logic-articulation-set': {
    title: 'Logic Pro Articulation Set Editor',
    url: 'https://support.apple.com/guide/logicpro/manage-articulations-articulation-set-editor-lgcp33a49091/mac',
    checkedAt: '2026-07-07',
    claim: 'DAW articulation can be authored as named ids and mapped to switches/output triggers.',
  },
  'logic-studio-horns-keyswitch': {
    title: 'Logic Pro Studio Horns keyswitch mapping',
    url: 'https://support.apple.com/guide/logicpro/keyswitch-mapping-lgcp5a6d61ad/mac',
    checkedAt: '2026-07-07',
    claim: 'Horn parts expose sustain/expressive/staccato/fall/scoop-style articulations as switchable performance states.',
  },
  'logic-studio-strings-keyswitch': {
    title: 'Logic Pro Studio Strings keyswitch mapping',
    url: 'https://support.apple.com/guide/logicpro/keyswitch-mapping-lgcpa2e1005a/mac',
    checkedAt: '2026-07-07',
    claim: 'String parts expose sustain/staccato/pizzicato/glissando-style articulations as switchable performance states.',
  },
  'cubase-expression-map': {
    title: 'Cubase Expression Maps',
    url: 'https://www.steinberg.help/r/cubase-pro/15.0/en/cubase_nuendo/topics/expression_maps/expression_maps_c.html',
    checkedAt: '2026-07-07',
    claim: 'Expression maps make articulations explicit and controllable for MIDI notes/instruments.',
  },
  'midi-cc-table': {
    title: 'MIDI 1.0 Control Change messages',
    url: 'https://midi.org/midi-1-0-control-change-messages',
    checkedAt: '2026-07-07',
    claim: 'CC lanes provide standard control targets including breath/expression/pedal-style controllers.',
  },
  'vsl-legato-overlap': {
    title: 'Vienna Symphonic Library orchestration recipe',
    url: 'https://www.vsl.co.at/tutorials/guides/orchestration-recipes/recipe27',
    checkedAt: '2026-07-07',
    claim: 'Legato sample playback is commonly driven by note overlap plus expression shaping.',
  },
  'sax-jazz-legato-tonguing': {
    title: 'Jazz sax articulation lesson',
    url: 'https://www.getyoursaxtogether.com/blog/articulation2',
    checkedAt: '2026-07-07',
    claim: 'Jazz sax lines are treated as smooth/connected, with tonguing patterns used for phrasing rather than per-note chopping.',
  },
  'sax-light-airflow-tonguing': {
    title: 'Yamaha saxophone tonguing guidance',
    url: 'https://au.yamaha.com/en/education/greatstart/articles/ensemble-learning/saxophone-tonguing.html',
    checkedAt: '2026-07-07',
    claim: 'Light tongue contact should minimize interruption to airflow, avoiding heavy disruptive articulation.',
  },
};

