import type {
  DeclaredMidiBaseline,
  DeclaredProgramEvent,
  RichSmfDocument,
} from './types';

export function extractDeclaredMidiBaseline(
  document: RichSmfDocument,
): DeclaredMidiBaseline {
  const usedChannels = new Set<number>();
  const bankMsb = new Array<number>(16).fill(0);
  const bankLsb = new Array<number>(16).fill(0);
  const programEvents: DeclaredProgramEvent[] = [];

  for (const event of document.events) {
    if (event.kind !== 'channel') continue;
    usedChannels.add(event.channel);
    if (event.type === 'cc' && event.data1 === 0) {
      bankMsb[event.channel] = event.data2;
    } else if (event.type === 'cc' && event.data1 === 32) {
      bankLsb[event.channel] = event.data2;
    } else if (event.type === 'programChange') {
      programEvents.push({
        tick: event.tick,
        trackIndex: event.trackIndex,
        channel: event.channel,
        program: event.data1,
        bankMsb: bankMsb[event.channel],
        bankLsb: bankLsb[event.channel],
      });
    }
  }

  const tracks = document.tracks.map((track) => ({
    trackIndex: track.index,
    name: track.name,
    instrumentName: track.instrumentName,
    endTick: track.endTick,
    eventCount: track.events.length,
    channelNumbers: Array.from(new Set(
      track.events
        .filter((event) => event.kind === 'channel')
        .map((event) => event.channel),
    )).sort((a, b) => a - b),
    programs: programEvents.filter((event) => event.trackIndex === track.index),
    textEvents: document.textEvents.filter((event) => event.trackIndex === track.index),
  }));

  return {
    format: document.format,
    declaredTrackCount: document.declaredTrackCount,
    timeDivision: document.timeDivision,
    analysisSupport: document.analysisSupport,
    durationTicks: document.durationTicks,
    tempoMap: document.tempoMap,
    timeSignatureMap: document.timeSignatureMap,
    keySignatureMap: document.keySignatureMap,
    tracks,
    usedChannels: Array.from(usedChannels).sort((a, b) => a - b),
    programEvents,
    markers: document.textEvents.filter((event) => event.metaType === 0x06),
    cuePoints: document.textEvents.filter((event) => event.metaType === 0x07),
    lyrics: document.textEvents.filter((event) => event.metaType === 0x05),
    warnings: document.warnings,
  };
}
