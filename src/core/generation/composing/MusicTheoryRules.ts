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
    public static getPassingChord(targetNumeral: string, type: 'SecondaryDominant' | 'Diminished7' | 'TritoneSub' | 'Chromatic' | 'DescendingDiminished' | 'SharpFourHalfDim'): string | null {
        const base = targetNumeral.replace(/maj9|maj7|m7b5|dim7|dim|°|aug|sus4|m9|m7|9|7|b5|add9/g, '');
        
        if (type === 'SharpFourHalfDim') {
            // #IVm7b5 is typically used to approach IV or V
            if (base === 'IV' || base === 'V') {
                return '#ivm7b5';
            }
            return null;
        }

        if (type === 'SecondaryDominant') {
            const map: Record<string, string> = {
                'I': 'V7', 'i': 'V7', 'Imaj7': 'V7', 'im7': 'V7', 'im9': 'V7', 'Imaj9': 'V7', 'iadd9': 'V7', 'Iadd9': 'V7',
                'ii': 'VI7', 'ii7': 'VI7', 'IIm': 'VI7', 'iim9': 'VI7',
                'iii': 'VII7', 'iii7': 'VII7', 'IIIm': 'VII7', 'iiim7': 'VII7',
                'IV': 'I7', 'IVmaj7': 'I7', 'iv': 'I7', 'IVmaj9': 'I7', 'ivm9': 'I7',
                'V': 'II7', 'V7': 'II7', 'v': 'II7', 'Vsus4': 'II7', 'V13': 'II7',
                'vi': 'III7', 'vi7': 'III7', 'VIm': 'III7', 'vim9': 'III7'
            };
            return map[base] || null;
        } 
        
        if (type === 'Diminished7') {
            const map: Record<string, string> = {
                'I': 'vii°', 'i': 'vii°', 'Imaj7': 'vii°', 'im7': 'vii°', 'im9': 'vii°', 'Imaj9': 'vii°', 'iadd9': 'vii°', 'Iadd9': 'vii°'
            };
            return map[base] || null;
        }

        if (type === 'DescendingDiminished') {
            // e.g. target is iii, passing is ivdim
            const map: Record<string, string> = {
                'I': 'biidim', 'i': 'biidim', 'Imaj7': 'biidim', 'im7': 'biidim', 'im9': 'biidim', 'Imaj9': 'biidim', 'iadd9': 'biidim', 'Iadd9': 'biidim',
                'ii': 'biiidim', 'ii7': 'biiidim', 'IIm': 'biiidim', 'iim9': 'biiidim',
                'iii': 'ivdim', 'iii7': 'ivdim', 'IIIm': 'ivdim', 'iiim7': 'ivdim',
                'IV': 'bVdim', 'IVmaj7': 'bVdim', 'iv': 'bVdim', 'IVmaj9': 'bVdim', 'ivm9': 'bVdim',
                'V': 'bvidim', 'V7': 'bvidim', 'v': 'bvidim', 'Vsus4': 'bvidim', 'V13': 'bvidim',
                'vi': 'bviidim', 'vi7': 'bviidim', 'VIm': 'bviidim', 'vim9': 'bviidim'
            };
            return map[base] || null;
        }

        if (type === 'TritoneSub') {
            const map: Record<string, string> = {
                'I': 'bII7', 'i': 'bII7', 'Imaj7': 'bII7', 'im7': 'bII7', 'im9': 'bII7', 'Imaj9': 'bII7', 'iadd9': 'bII7', 'Iadd9': 'bII7',
                'ii': 'bIII7', 'ii7': 'bIII7', 'IIm': 'bIII7', 'iim9': 'bIII7',
                'iii': 'IV7', 'iii7': 'IV7', 'IIIm': 'IV7', 'iiim7': 'IV7',
                'IV': 'bV7', 'IVmaj7': 'bV7', 'iv': 'bV7', 'IVmaj9': 'bV7', 'ivm9': 'bV7',
                'V': 'bVI7', 'V7': 'bVI7', 'v': 'bVI7', 'Vsus4': 'bVI7', 'V13': 'bVI7',
                'vi': 'bVII7', 'vi7': 'bVII7', 'VIm': 'bVII7', 'vim9': 'bVII7'
            };
            return map[base] || null;
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
                // 🚨 移除 vii° 替换 V 的逻辑，防止生成悬空导和弦
                if (allowedBorrowed.includes('TritoneSub')) subs.push('bII7');
                if (allowedBorrowed.includes('ModalMixture')) subs.push('v'); // minor v
            }
        }

        return subs;
    }
}
