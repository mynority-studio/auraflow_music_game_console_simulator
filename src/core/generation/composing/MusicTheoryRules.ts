import { GeneratedChord } from '../types';

export type ChordFunction = 'Tonic' | 'Subdominant' | 'Dominant';

export class MusicTheoryRules {
    // 1. 和弦功能映射 (Chord Function Mapping)
    public static getChordFunction(numeral: string): ChordFunction {
        const base = numeral.replace(/maj9|maj7|m7b5|dim7|dim|°|aug|sus4|m9|m7|9|7|b5|add9/g, '').replace(/b|#/g, '').toLowerCase();
        if (['i', 'iii', 'vi'].includes(base)) return 'Tonic';
        if (['iv', 'ii'].includes(base)) return 'Subdominant';
        if (['v', 'vii'].includes(base)) return 'Dominant';
        return 'Tonic'; // Default fallback
    }

    // 2. 严密的经过和弦推导 (Strict Passing Chord Derivation)
    public static getPassingChord(targetNumeral: string, type: 'SecondaryDominant' | 'Diminished7' | 'TritoneSub' | 'Chromatic' | 'DescendingDiminished'): string | null {
        const base = targetNumeral.replace(/maj9|maj7|m7b5|dim7|dim|°|aug|sus4|m9|m7|9|7|b5|add9/g, '');
        
        if (type === 'SecondaryDominant') {
            const map: Record<string, string> = {
                'ii': 'VI7', 'ii7': 'VI7', 'IIm': 'VI7',
                'iii': 'VII7', 'iii7': 'VII7', 'IIIm': 'VII7',
                'IV': 'I7', 'IVmaj7': 'I7', 'iv': 'I7',
                'V': 'II7', 'V7': 'II7', 'v': 'II7',
                'vi': 'III7', 'vi7': 'III7', 'VIm': 'III7'
            };
            return map[base] || 'V7';
        } 
        
        if (type === 'Diminished7') {
            const map: Record<string, string> = {
                'ii': '#idim', 'ii7': '#idim', 'IIm': '#idim',
                'iii': '#iidim', 'iii7': '#iidim', 'IIIm': '#iidim',
                'IV': '#iiidim', 'IVmaj7': '#iiidim', 'iv': '#iiidim',
                'V': '#ivdim', 'V7': '#ivdim', 'v': '#ivdim',
                'vi': '#vdim', 'vi7': '#vdim', 'VIm': '#vdim'
            };
            return map[base] || 'vii°';
        }

        if (type === 'DescendingDiminished') {
            // e.g. target is iii, passing is ivdim
            const map: Record<string, string> = {
                'ii': 'biiidim', 'ii7': 'biiidim', 'IIm': 'biiidim',
                'iii': 'ivdim', 'iii7': 'ivdim', 'IIIm': 'ivdim',
                'IV': 'bVdim', 'IVmaj7': 'bVdim', 'iv': 'bVdim',
                'V': 'bvidim', 'V7': 'bvidim', 'v': 'bvidim',
                'vi': 'bviidim', 'vi7': 'bviidim', 'VIm': 'bviidim'
            };
            return map[base] || null;
        }

        if (type === 'TritoneSub') {
            const map: Record<string, string> = {
                'ii': 'bIII7', 'ii7': 'bIII7', 'IIm': 'bIII7',
                'iii': 'IV7', 'iii7': 'IV7', 'IIIm': 'IV7',
                'IV': 'bV7', 'IVmaj7': 'bV7', 'iv': 'bV7',
                'V': 'bVI7', 'V7': 'bVI7', 'v': 'bVI7',
                'vi': 'bVII7', 'vi7': 'bVII7', 'VIm': 'bVII7'
            };
            return map[base] || 'bII7';
        }

        if (type === 'Chromatic') {
            // Chromatic approach from a half step above or below
            // For simplicity, we'll return a dominant 7th chord a half step above
            const map: Record<string, string> = {
                'ii': 'bIII7', 'ii7': 'bIII7', 'IIm': 'bIII7',
                'iii': 'IV7', 'iii7': 'IV7', 'IIIm': 'IV7',
                'IV': 'bV7', 'IVmaj7': 'bV7', 'iv': 'bV7',
                'V': 'bVI7', 'V7': 'bVI7', 'v': 'bVI7',
                'vi': 'bVII7', 'vi7': 'bVII7', 'VIm': 'bVII7'
            };
            return map[base] || 'bII7'; // Often overlaps with TritoneSub
        }

        return null;
    }

    // 3. 替代和弦推导 (Chord Substitution Derivation)
    public static getSubstitution(numeral: string, allowedBorrowed: string[] = []): string[] {
        const subs: string[] = [];
        const func = this.getChordFunction(numeral);
        const base = numeral.replace(/maj9|maj7|m7b5|dim7|dim|°|aug|sus4|m9|m7|9|7|b5|add9/g, '');

        if (func === 'Tonic') {
            if (base === 'I' || base === 'i') subs.push('vi', 'iii');
            if (base === 'vi') subs.push('I');
            if (base === 'iii') subs.push('I');
        } else if (func === 'Subdominant') {
            if (base === 'IV' || base === 'iv') {
                subs.push('ii');
                if (allowedBorrowed.includes('ModalMixture')) subs.push('iv'); // If major IV, borrow minor iv
            }
            if (base === 'ii') {
                subs.push('IV');
                if (allowedBorrowed.includes('Neapolitan')) subs.push('bII');
            }
        } else if (func === 'Dominant') {
            if (base === 'V' || base === 'v') {
                subs.push('vii°');
                if (allowedBorrowed.includes('TritoneSub')) subs.push('bII7');
                if (allowedBorrowed.includes('ModalMixture')) subs.push('v'); // minor v
            }
        }

        return subs;
    }
}
