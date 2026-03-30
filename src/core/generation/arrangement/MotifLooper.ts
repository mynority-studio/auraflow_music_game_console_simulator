import { NoteData, GeneratedChord } from '../types';
import { HarmonyCore } from '../composing/HarmonyCore';

export class MotifLooper {
    public static loopMotif(
        motif: NoteData[], 
        chord: GeneratedChord, 
        tonality: string, 
        targetOctave: number = 60,
        role: 'Foreground' | 'Middleground' | 'Background' = 'Middleground'
    ): NoteData[] {
        if (!motif || motif.length === 0) return [];
        
        let maxMotifOnset = 0;
        motif.forEach(n => { if (n.onset > maxMotifOnset) maxMotifOnset = n.onset; });
        
        // Find motif length in beats (round up to nearest bar, assuming 4/4 for simplicity, or just use 4)
        const motifLengthBeats = Math.max(4, Math.ceil((maxMotifOnset + 1) / 4) * 4);
        
        const notes: NoteData[] = [];
        let currentBeat = Math.floor(chord.startBeat / motifLengthBeats) * motifLengthBeats;
        
        // Calculate average pitch of the motif to preserve contour when shifting
        const avgPitch = motif.reduce((sum, n) => sum + n.pitch, 0) / motif.length;
        let octaveShift = 0;
        while (avgPitch + octaveShift < targetOctave - 6) octaveShift += 12;
        while (avgPitch + octaveShift > targetOctave + 6) octaveShift -= 12;
        
        while (currentBeat < chord.endBeat) {
            // 🌟 智能变奏逻辑 (AABA / Turnaround)
            const phraseIndex = Math.floor(currentBeat / motifLengthBeats) % 4;
            const isContrast = phraseIndex === 2; // 'B' section of AABA
            const isTurnaround = phraseIndex === 3; // Turnaround at the end of phrase
            
            motif.forEach((n, index) => {
                const onset = currentBeat + (n.onset % motifLengthBeats);
                if (onset >= chord.startBeat && onset < chord.endBeat) {
                    // Snap to chord tones or safe scale
                    const safeScalePcs = HarmonyCore.getSafeScalePitches(chord, tonality);
                    let pitch = n.pitch + octaveShift;
                    
                    // Apply variation
                    if (isContrast) {
                        // Shift up a 4th (5 semitones) for contrast, it will snap to scale anyway
                        // For basslines, maybe just shift up a 3rd or 4th
                        pitch += role === 'Background' ? 5 : 5;
                    } else if (isTurnaround && index >= motif.length - 2) {
                        // Change the ending notes for turnaround (drop down a 5th)
                        pitch -= role === 'Background' ? 0 : 7; // Don't drop bass too low
                    }
                    
                    pitch = HarmonyCore.snapToScale(pitch, safeScalePcs);
                    
                    notes.push({
                        pitch,
                        onset,
                        duration: n.duration,
                        velocity: n.velocity * 0.8 // Slightly softer for accompaniment
                    });
                }
            });
            currentBeat += motifLengthBeats;
        }
        
        return notes;
    }
}
