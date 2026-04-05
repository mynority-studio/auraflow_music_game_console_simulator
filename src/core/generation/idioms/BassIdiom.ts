import { InstrumentIdiom, IdiomContext } from './BaseIdiom';
import { NoteData } from '../types';
import { PRNGManager } from '../../utils/PRNG';

export class BassIdiom implements InstrumentIdiom {
    public generate(context: IdiomContext): NoteData[] {
        const { chord, energyLevel, melodyNotes, isSparseSection, isSectionEnd, nextChord } = context;
        const notes: NoteData[] = [];
        
        let finalRoot = chord.root % 12;
        finalRoot += 24; // C1 to B1 (24 to 35)
        if (finalRoot < 28) finalRoot += 12; // E1 to Eb2 (28 to 39)

        const duration = chord.endBeat - chord.startBeat;

        // 1. Rhythm Lock (Tutti) Logic
        // If energy is high (>= 7), there's a chance the bass locks onto the melody rhythm
        const localMelodyNotes = melodyNotes.filter(n => n.onset >= chord.startBeat && n.onset < chord.endBeat);
        
        if (energyLevel >= 7 && localMelodyNotes.length > 0 && PRNGManager.next() < 0.4) {
            // Rhythm Lock: Match melody onsets
            // P-1: dedup via linear scan instead of Set
            const uniqueOnsets: number[] = [];
            for (const mn of localMelodyNotes) {
                if (uniqueOnsets.indexOf(mn.onset) === -1) uniqueOnsets.push(mn.onset);
            }

            const sortedOnsets = uniqueOnsets.sort((a, b) => a - b);
            for (let i = 0; i < sortedOnsets.length; i++) {
                const onset = sortedOnsets[i];
                const nextOnset = i < sortedOnsets.length - 1 ? sortedOnsets[i + 1] : chord.endBeat;
                const noteDuration = Math.min(0.5, nextOnset - onset);
                
                notes.push({
                    pitch: finalRoot,
                    onset: onset,
                    duration: noteDuration,
                    velocity: 90 + Math.floor(PRNGManager.next() * 20) // 90-110
                });
            }
        } else {
            // 2. Standard Bass Groove
            if (isSparseSection || energyLevel <= 3) {
                // Sparse: Just the root on the downbeat
                notes.push({
                    pitch: finalRoot,
                    onset: chord.startBeat,
                    duration: duration > 2 ? 2 : duration,
                    velocity: 70 + Math.floor(PRNGManager.next() * 15)
                });
                
                // Occasional 5th drop on weak beat if duration is long enough
                if (duration >= 4 && PRNGManager.next() < 0.3) {
                    notes.push({
                        pitch: finalRoot + 7,
                        onset: chord.startBeat + 2,
                        duration: 1,
                        velocity: 60
                    });
                }
            } else if (energyLevel >= 6) {
                // High energy: 8th notes or syncopated
                for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.5) {
                    // Skip some off-beats for groove
                    if (Math.abs(beat % 1) >= 1e-6 && PRNGManager.next() < 0.3) continue;

                    notes.push({
                        pitch: finalRoot,
                        onset: beat,
                        duration: 0.25,
                        velocity: Math.abs(beat % 1) < 1e-6 ? 95 : 80
                    });
                }
            } else {
                // Mid energy: Quarter notes (4-on-the-floor style)
                for (let beat = chord.startBeat; beat < chord.endBeat; beat += 1) {
                    notes.push({
                        pitch: finalRoot,
                        onset: beat,
                        duration: 0.5,
                        velocity: 85
                    });
                    
                    // Occasional syncopation before the next beat
                    if (PRNGManager.next() < 0.2 && beat + 0.75 < chord.endBeat) {
                        notes.push({
                            pitch: finalRoot,
                            onset: beat + 0.75,
                            duration: 0.25,
                            velocity: 75
                        });
                    }
                }
            }
        }

        // 3. Chromatic Walkdown Fill
        // If it's the end of a section, we can do a chromatic walk to the next chord
        if (isSectionEnd && nextChord && duration >= 2 && PRNGManager.next() < 0.5) {
            let nextRoot = (nextChord.root % 12) + 24;
            if (nextRoot < 28) nextRoot += 12;
            
            const walkStartBeat = chord.endBeat - 1;
            // Remove notes in the last beat
            for (let i = notes.length - 1; i >= 0; i--) {
                if (notes[i].onset >= walkStartBeat) {
                    notes.splice(i, 1);
                }
            }
            
            const diff = nextRoot - finalRoot;
            // If the next chord is 1 to 7 semitones away, we can do a chromatic approach
            if (Math.abs(diff) > 0 && Math.abs(diff) <= 7) {
                const step = diff > 0 ? 1 : -1;
                // 3 notes approaching the target
                notes.push({ pitch: nextRoot - 3*step, onset: walkStartBeat, duration: 0.33, velocity: 85 });
                notes.push({ pitch: nextRoot - 2*step, onset: walkStartBeat + 0.33, duration: 0.33, velocity: 90 });
                notes.push({ pitch: nextRoot - 1*step, onset: walkStartBeat + 0.66, duration: 0.34, velocity: 95 });
            } else {
                // Just play the root if we can't walk smoothly
                notes.push({ pitch: finalRoot, onset: walkStartBeat, duration: 1, velocity: 85 });
            }
        }

        return notes;
    }
}
