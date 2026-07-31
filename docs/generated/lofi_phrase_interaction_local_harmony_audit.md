# LOFI-HIPHOP-PHRASE-INTERACTION-V3 — Local harmony audit

Seeds: **200** (major/minor alternating). This is a read-only audit; it does not edit NoteIR.

## Pool consumption

- Complete LOFI pool: 30 prototypes.
- Clark-derived candidates reached: 7/7 (lofi_major_plagal_descent_2, lofi_major_whole_step_planing_4, lofi_major_parallel_minor_fall_4, lofi_minor_turnaround_4, lofi_minor_aeolian_ebb_8, lofi_minor_late_cadence_4, lofi_minor_third_bass_vamp_4).
- Maximum single Clark-derived candidate song share: 16.00%.
- Other pre-existing LOFI candidates reached: 15.

## Local-harmony measurements

| Measurement | Result |
|---|---:|
| Grammar structural terminal conformance | 100.00% |
| Grammar fill terminal conformance | 100.00% |
| Grammar A terminal conformance (paired resolution or local fallback) | 100.00% |
| Grammar long illegal cross-chord exposure | 0.00% |
| Comp attack chord-spelling conformance | 100.00% |
| Comp long illegal cross-chord exposure | 0.00% |
| Pad attack contract conformance | 100.00% |
| Pad long illegal cross-chord exposure | 0.00% |

## Phrase interaction measurements

| Measurement | Result |
|---|---:|
| Compiled statement → variation → return sentences | 164 |
| Variation rhythm fingerprint match | 100.00% |
| Return rhythm fingerprint match | 100.00% |
| Return terminal local-stable resolution | 100.00% |
| Variation louder than release/return | 100.00% |
| Comp onsets / Lead-support bar | 2.98 |
| Comp onsets / Lead-rest bar | 3.29 |
| Answer bars with Comp gesture | 100.00% |
| Lead notes inside Comp-answer bars | 0 |
| Kick structural offset median ± σ | 0.00 ± 0.00 ms |
| Snare structural offset median ± σ | 19.37 ± 0.93 ms |
| Traceable Drum turnaround bars | 737/737 |

## Gates

- PASS — `clarkIsCandidateOnly`
- PASS — `noClarkCandidateDominates`
- PASS — `oldAndClarkPoolBothConsumed`
- PASS — `grammarStructuralLocalHarmony`
- PASS — `grammarFillLocalHarmony`
- PASS — `grammarApproachResolution`
- PASS — `grammarNoLongIllegalSuspension`
- PASS — `compLocalChordAttacks`
- PASS — `compNoLongIllegalSuspension`
- PASS — `padLocalContractAttacks`
- PASS — `padNoLongIllegalSuspension`
- PASS — `phraseScorePresentForEverySeed`
- PASS — `statementVariationReturnCompiled`
- PASS — `terminalTensionResolves`
- PASS — `phraseDynamicArcSurvivesMicroVariation`
- PASS — `compYieldsWhenLeadSpeaks`
- PASS — `compAnswersOnlyInsideLeadRest`
- PASS — `drumTurnaroundTracesToAnswerScore`
- PASS — `systemicKickSnarePocket`

## Finding counts


