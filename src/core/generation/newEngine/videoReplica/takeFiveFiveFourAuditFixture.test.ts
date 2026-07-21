import { describe, expect, it } from 'vitest';
import {
  buildTakeFiveFiveFourAuditFixture,
  TAKE_FIVE_FIVE_FOUR_AUDIT_FIXTURE_METADATA,
} from './takeFiveFiveFourAuditFixture';

describe('Take Five fixed score · 5/4 audit-only fixture', () => {
  it('labels the provisional fixed score as descriptive and product-ineligible', () => {
    expect(TAKE_FIVE_FIVE_FOUR_AUDIT_FIXTURE_METADATA).toMatchObject({
      scope: 'audit-only',
      authority: 'descriptive-non-authoritative',
      productEligible: false,
      curationStatus: 'provisional',
    });
    expect(TAKE_FIVE_FIVE_FOUR_AUDIT_FIXTURE_METADATA.limitations).toHaveLength(4);
  });

  it('retains the historical performed score unchanged for offline comparison', () => {
    const fixture = buildTakeFiveFiveFourAuditFixture();
    expect(fixture.fingerprint).toMatchObject({
      ppq: 480,
      meter: [5, 4],
      bpm: 200,
      durationTicks: 85_860,
      durationBars: 35.775,
      noteCountByRole: { bass: 102, comp: 275, lead: 178 },
      firstTickByRole: { bass: 0, comp: 24_722, lead: 1_117 },
      lastTickByRole: { bass: 23_924, comp: 82_308, lead: 81_137 },
    });
    expect(fixture.ir.tracks.map((track) => track.role)).toEqual(['bass', 'comp', 'lead']);
    expect(fixture.ir.tracks.reduce((sum, track) => sum + track.notes.length, 0)).toBe(555);
  });
});
