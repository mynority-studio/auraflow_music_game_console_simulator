import { AudioMixer } from "./AudioMixer";
import { spessaSynth } from "./SynthManager";

// ==========================================
// 📄 文件路径: /src/core/audio/Instruments.ts
// 🌟 V3.0 SpessaSynth GM128 Integration
// ==========================================

const GM_MAPPING: Record<string, number> = {
  // Lead
  Acoustic_Grand: 0,
  Electric_Piano_1: 4,
  Lead_2_Sawtooth: 81,
  Violin: 40,
  Viola: 41,
  Cello: 42,
  Contrabass: 43,
  Flute: 73,
  Alto_Sax: 65,
  Tenor_Sax: 66,
  Harmonica: 22,
  
  // Chord
  Acoustic_Guitar_Nylon: 24,
  Acoustic_Guitar_Steel: 25,
  Electric_Guitar_Clean: 27,
  String_Ensemble_1: 48,
  Synth_Strings_1: 50,
  
  // Pad & Choir
  Pad_1_NewAge: 88,
  Pad_2_Warm: 89,
  Choir_Aahs: 52,
  Voice_Oohs: 53,
  Solo_Vox: 85, // GM128 Solo Vox
  Meowsynth: 0, // Custom bank 100
  
  // Arp / Decoration
  Vibraphone: 11,
  Marimba: 12,
  Pizzicato_Strings: 45,
  Reverse_Cymbal: 119, // 🌟 P2: Reverse Cymbal
  
  // Bass
  Acoustic_Bass: 32,
  Electric_Bass_Finger: 33,
  Synth_Bass_1: 38,
  Synth_Bass_2: 39,
  
  // Drums
  Standard_DrumKit: 0,
  Electronic_DrumKit: 24,
  TR808_DrumKit: 25,
  Orchestral_DrumKit: 48,
  
  System_Aura: 81,
};

// Helper to convert note name to MIDI number (e.g. "C4" -> 60)
function noteToMidi(note: string): number {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const match = note.match(/^([A-G]#?)(\d+)$/);
    if (match) {
        const n = match[1];
        const octave = parseInt(match[2], 10);
        const index = notes.indexOf(n);
        if (index !== -1) {
            return (octave + 1) * 12 + index;
        }
    }
    return 60; // Default to C4 if parsing fails
}

class SpessaSynthWrapper {
    constructor(
        public channel: number,
        public program: number,
        public isDrum: boolean,
        public bank: number = 0
    ) {
        this.loaded = true;
        if (spessaSynth) {
            spessaSynth.controllerChange(this.channel, 0, this.bank);
            spessaSynth.controllerChange(this.channel, 32, 0);
            spessaSynth.programChange(this.channel, this.program);
        } else {
            console.warn(`[SpessaSynthWrapper] spessaSynth is null during constructor for ch=${this.channel}`);
        }
    }
    
    public loaded = true;

    public triggerAttackRelease(freq: number | string, duration: number, time: number, velocity: number = 1, pitchBend?: number, pitchBendDuration?: number, fadeOutDuration?: number) {
        if (!spessaSynth) {
            console.warn("[SpessaSynthWrapper] spessaSynth is null");
            return;
        }
        
        let midiNote = 60;
        if (typeof freq === 'number') {
            midiNote = Math.round(freq);
        } else {
            midiNote = noteToMidi(freq);
        }
        
        let vel = Math.max(0, Math.min(127, Math.round(velocity * 127)));
        
        // Reduce velocity for Lead Sawtooth (program 81) to make it less harsh
        if (this.program === 81) {
            vel = Math.round(vel * 0.6);
        }
        
        // Reset expression (CC 11) to max before playing
        spessaSynth.controllerChange(this.channel, 11, 127, { time });
        
        // If there's a pitch bend, set the range and start value
        if (pitchBend !== undefined && pitchBendDuration !== undefined) {
            // Set pitch bend range to max of 12 or abs(pitchBend)
            const range = Math.max(12, Math.ceil(Math.abs(pitchBend)));
            spessaSynth.pitchWheelRange(this.channel, range, { time });
            
            // Start at center (8192)
            spessaSynth.pitchWheel(this.channel, 8192, { time });
            spessaSynth.noteOn(this.channel, midiNote, vel, { time });
            
            // Animate pitch wheel at the end of the note
            const steps = 20;
            const stepTime = pitchBendDuration / steps;
            const targetValue = 8192 + Math.round((pitchBend / range) * 8192);
            
            // Delay the start of the pitch bend so it finishes right as the note ends
            const bendDelay = Math.max(0, duration - pitchBendDuration);
            
            for (let i = 1; i <= steps; i++) {
                const currentValue = 8192 + Math.round(((targetValue - 8192) * i) / steps);
                spessaSynth.pitchWheel(this.channel, currentValue, { time: time + bendDelay + (stepTime * i) });
            }
            
            // Reset pitch wheel after note off
            spessaSynth.pitchWheel(this.channel, 8192, { time: time + duration + 0.05 });
        } else {
            spessaSynth.pitchWheel(this.channel, 8192, { time });
            spessaSynth.noteOn(this.channel, midiNote, vel, { time });
        }
        
        // Fade out using Expression (CC 11) if requested
        if (fadeOutDuration !== undefined && fadeOutDuration > 0) {
            const fadeSteps = 20;
            const fadeStepTime = fadeOutDuration / fadeSteps;
            const fadeDelay = Math.max(0, duration - fadeOutDuration);
            
            for (let i = 1; i <= fadeSteps; i++) {
                // Fade from 127 down to 0
                const currentValue = Math.max(0, Math.round(127 * (1 - (i / fadeSteps))));
                spessaSynth.controllerChange(this.channel, 11, currentValue, { time: time + fadeDelay + (fadeStepTime * i) });
            }
        }

        // Note off
        spessaSynth.noteOff(this.channel, midiNote, { time: time + duration });
    }
    
    public dispose() {
        // No-op for SpessaSynth wrapper
    }
}

export class InstrumentRegistry {
  private mixer: AudioMixer;
  private synths: Map<string, SpessaSynthWrapper> = new Map();
  private nextChannel: number = 0;

  constructor(mixer: AudioMixer) {
    this.mixer = mixer;
  }

  public getInstrument(id: string, role: "Foreground" | "Midground" | "Background" | "Rhythm", trackId: string = "default", mixingConfig?: { pan?: number, reverb?: number, volume?: number, delay?: number, chorus?: number }): any {
    let configId = GM_MAPPING[id] !== undefined ? id : "Acoustic_Grand";
    if (id === "System_Aura") {
      configId = "System_Aura";
    } else if (GM_MAPPING[id] === undefined) {
      if (id.includes("Drum") || id.includes("Kit")) configId = "Standard_DrumKit";
      else if (id.includes("Bass") && id.includes("Synth")) configId = "Synth_Bass_1";
      else if (id.includes("Bass")) configId = "Electric_Bass_Finger";
      else if (id.includes("Sax")) configId = "Alto_Sax";
      else if (id.includes("Choir") || id.includes("Voice") || id.includes("Aah") || id.includes("Ooh")) configId = "Voice_Oohs";
      else if (id.includes("Pad")) configId = "Pad_1_NewAge";
      else if (id.includes("Synth") || id.includes("Lead")) configId = "Lead_2_Sawtooth";
      else if (id.includes("Guitar") && id.includes("Clean")) configId = "Electric_Guitar_Clean";
      else if (id.includes("Guitar") && id.includes("Nylon")) configId = "Acoustic_Guitar_Nylon";
      else if (id.includes("Guitar")) configId = "Acoustic_Guitar_Steel";
      else if (id.includes("String")) configId = "String_Ensemble_1";
      else if (id.includes("Piano") && id.includes("Electric")) configId = "Electric_Piano_1";
      else configId = "Acoustic_Grand";
    }

    const instanceId = `${configId}_${role}_${trackId}`;

    if (!this.synths.has(instanceId)) {
      const isDrum = configId.includes("Drum") || configId.includes("Kit");
      let channel = 0;
      
      if (isDrum) {
          channel = 9;
      } else {
          channel = this.nextChannel % 16;
          if (channel === 9) {
              this.nextChannel++;
              channel = this.nextChannel % 16;
          }
          this.nextChannel++;
      }

      let program = GM_MAPPING[configId] || 0;
      let bank = 0;

      // If the user selected Meowsynth, but we don't have the sf2, fallback to Solo_Vox (85)
      if (configId === 'Meowsynth') {
          program = 85; // Solo_Vox
          bank = 0;
      }

      const synth = new SpessaSynthWrapper(channel, program, isDrum, bank);
      
      if (spessaSynth) {
          // Apply mixing config via MIDI CC
          let vol = 100;
          let pan = 64;
          let reverb = 0;
          let chorus = 0;
          
          if (mixingConfig) {
              // Convert volume (dB) to MIDI CC 7 (0-127)
              // Map 0 dB to 80 to allow headroom for positive dB values
              vol = Math.max(0, Math.min(127, Math.round(80 * Math.pow(10, (mixingConfig.volume || 0) / 20))));
              
              // Convert pan (-1 to 1) to MIDI CC 10 (0-127)
              if (mixingConfig.pan !== undefined && (mixingConfig.pan !== 0 || role === 'Foreground')) {
                  pan = Math.max(0, Math.min(127, Math.round((mixingConfig.pan + 1) * 63.5)));
              }
              
              reverb = Math.max(0, Math.min(127, Math.round((mixingConfig.reverb || 0) * 127)));
              chorus = Math.max(0, Math.min(127, Math.round(mixingConfig.chorus || 0)));
          }
          
          if (configId === "Lead_2_Sawtooth") {
              vol = Math.round(vol * 0.25); // Reduce volume significantly for Lead Sawtooth (was 0.5, now 0.25)
          }
          
          spessaSynth.controllerChange(channel, 7, vol); // Volume
          spessaSynth.controllerChange(channel, 10, pan); // Pan
          spessaSynth.controllerChange(channel, 91, reverb); // Reverb
          spessaSynth.controllerChange(channel, 93, chorus); // Chorus
      }

      this.synths.set(instanceId, synth);
      return synth;
    }

    return this.synths.get(instanceId)!;
  }
}
