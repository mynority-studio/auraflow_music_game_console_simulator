import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QnGenerationMonitorView, type QnMonitorReadout } from './QnGenerationMonitorView';

const readout: QnMonitorReadout = {
  status: 'pass',
  attempts: 1,
  bpm: 96,
  bars: 8,
  tracks: [{
    role: 'lead',
    count: 24,
    instrument: 'Bright Acoustic Piano',
    bank: 0,
    program: 1,
  }],
};

describe('QnGenerationMonitorView takeover voice row', () => {
  it('shows the selectable takeover Lead route beside the generated tracks', () => {
    const html = renderToStaticMarkup(
      React.createElement(QnGenerationMonitorView, {
        status: 'playing',
        readout,
        roll: null,
        logLines: [],
        takeoverVoice: { bank: 0, program: 1 },
        onTakeoverVoiceChange: () => undefined,
      }),
    );

    expect(html).toContain('接管');
    expect(html).toContain('接管 Lead 声道 Dream 5504 音色');
    expect(html).toContain('ch15');
    expect(html).toContain('Ch16');
    expect(html).toContain('Bright Acoustic Piano');
  });
});
