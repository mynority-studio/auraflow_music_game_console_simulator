import type {
  MidiNoteSpan,
  MidiNoteSpanResult,
  NoteReleaseReason,
  RichSmfDocument,
  SmfChannelEvent,
} from './types';

interface MutableNote {
  id: string;
  trackIndex: number;
  channel: number;
  pitch: number;
  velocity: number;
  noteOffVelocity: number;
  startTick: number;
  keyDownEndTick?: number;
  soundingEndTick?: number;
  releaseReason?: NoteReleaseReason;
  pedalExtended: boolean;
  inferredEnd: boolean;
}

const noteKey = (event: Pick<SmfChannelEvent, 'trackIndex' | 'channel' | 'data1'>): string =>
  `${event.trackIndex}:${event.channel}:${event.data1}`;

function closeKeyDown(
  note: MutableNote,
  tick: number,
  noteOffVelocity: number,
  reason: NoteReleaseReason,
  pedalDown: boolean,
): void {
  note.keyDownEndTick = Math.max(note.startTick, tick);
  note.noteOffVelocity = noteOffVelocity;
  note.releaseReason = reason;
  if (pedalDown && reason !== 'allSoundOff') {
    note.pedalExtended = true;
  } else {
    note.soundingEndTick = note.keyDownEndTick;
  }
}

/**
 * Pair Note On/Off events without destroying sustain-pedal semantics.
 *
 * Same-pitch overlaps are paired FIFO and warned because SMF itself does not
 * identify which Note On a later Note Off belongs to.
 */
export function buildMidiNoteSpans(document: RichSmfDocument): MidiNoteSpanResult {
  const warnings: string[] = [];
  const drafts: MutableNote[] = [];
  const activeByKey = new Map<string, MutableNote[]>();
  const sustainedByChannel = new Map<number, MutableNote[]>();
  const pedalDown = new Array<boolean>(16).fill(false);
  let nextId = 0;

  const closeSustained = (channel: number, tick: number, reason?: NoteReleaseReason): void => {
    const sustained = sustainedByChannel.get(channel) ?? [];
    for (const note of sustained) {
      if (note.soundingEndTick === undefined) {
        note.soundingEndTick = Math.max(note.startTick, tick);
        if (reason) note.releaseReason = reason;
      }
    }
    sustainedByChannel.set(channel, []);
  };

  const releaseActiveOnChannel = (
    channel: number,
    tick: number,
    reason: 'allNotesOff' | 'allSoundOff',
  ): void => {
    for (const [key, queue] of activeByKey.entries()) {
      const remaining: MutableNote[] = [];
      for (const note of queue) {
        if (note.channel !== channel) {
          remaining.push(note);
          continue;
        }
        closeKeyDown(note, tick, 0, reason, reason === 'allNotesOff' && pedalDown[channel]);
        if (note.soundingEndTick === undefined) {
          const sustained = sustainedByChannel.get(channel) ?? [];
          sustained.push(note);
          sustainedByChannel.set(channel, sustained);
        }
      }
      if (remaining.length > 0) activeByKey.set(key, remaining);
      else activeByKey.delete(key);
    }
    if (reason === 'allSoundOff') closeSustained(channel, tick, reason);
  };

  for (const event of document.events) {
    if (event.kind !== 'channel') continue;

    if (event.type === 'noteOn') {
      const key = noteKey(event);
      const queue = activeByKey.get(key) ?? [];
      if (queue.length > 0) {
        warnings.push(
          `轨 ${event.trackIndex + 1} ch ${event.channel + 1} note ${event.data1} tick ${event.tick}: 同音 Note On 重叠，按 FIFO 配对`,
        );
      }
      const note: MutableNote = {
        id: `n${nextId++}`,
        trackIndex: event.trackIndex,
        channel: event.channel,
        pitch: event.data1,
        velocity: event.data2,
        noteOffVelocity: 0,
        startTick: event.tick,
        pedalExtended: false,
        inferredEnd: false,
      };
      queue.push(note);
      activeByKey.set(key, queue);
      drafts.push(note);
      continue;
    }

    if (event.type === 'noteOff') {
      const key = noteKey(event);
      const queue = activeByKey.get(key) ?? [];
      const note = queue.shift();
      if (!note) {
        warnings.push(
          `轨 ${event.trackIndex + 1} ch ${event.channel + 1} note ${event.data1} tick ${event.tick}: 无匹配 Note On`,
        );
        continue;
      }
      if (queue.length > 0) activeByKey.set(key, queue);
      else activeByKey.delete(key);
      closeKeyDown(note, event.tick, event.data2, 'noteOff', pedalDown[event.channel]);
      if (note.soundingEndTick === undefined) {
        const sustained = sustainedByChannel.get(event.channel) ?? [];
        sustained.push(note);
        sustainedByChannel.set(event.channel, sustained);
      }
      continue;
    }

    if (event.type !== 'cc') continue;
    if (event.data1 === 64) {
      const wasDown = pedalDown[event.channel];
      const isDown = event.data2 >= 64;
      pedalDown[event.channel] = isDown;
      if (wasDown && !isDown) closeSustained(event.channel, event.tick);
    } else if (event.data1 === 123) {
      releaseActiveOnChannel(event.channel, event.tick, 'allNotesOff');
    } else if (event.data1 === 120) {
      releaseActiveOnChannel(event.channel, event.tick, 'allSoundOff');
    }
  }

  for (const queue of activeByKey.values()) {
    for (const note of queue) {
      note.keyDownEndTick = document.durationTicks;
      note.soundingEndTick = document.durationTicks;
      note.releaseReason = 'endOfFile';
      note.inferredEnd = true;
      warnings.push(
        `轨 ${note.trackIndex + 1} ch ${note.channel + 1} note ${note.pitch}: 文件结束前无 Note Off，按末 tick 闭合`,
      );
    }
  }
  for (let channel = 0; channel < 16; channel++) {
    const sustained = sustainedByChannel.get(channel) ?? [];
    for (const note of sustained) {
      if (note.soundingEndTick !== undefined) continue;
      note.soundingEndTick = document.durationTicks;
      note.releaseReason = 'endOfFile';
      note.inferredEnd = true;
      warnings.push(`ch ${channel + 1} note ${note.pitch}: 延音踏板未释放，按末 tick 闭合`);
    }
  }

  const notes: MidiNoteSpan[] = drafts.map((note) => ({
    id: note.id,
    trackIndex: note.trackIndex,
    channel: note.channel,
    pitch: note.pitch,
    velocity: note.velocity,
    noteOffVelocity: note.noteOffVelocity,
    startTick: note.startTick,
    keyDownEndTick: note.keyDownEndTick ?? document.durationTicks,
    soundingEndTick: note.soundingEndTick ?? document.durationTicks,
    releaseReason: note.releaseReason ?? 'endOfFile',
    pedalExtended: note.pedalExtended,
    inferredEnd: note.inferredEnd,
  }));
  notes.sort((a, b) => (a.startTick - b.startTick) || a.id.localeCompare(b.id));
  return { notes, warnings };
}

