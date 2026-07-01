# LOFI Texture Bridge Fidelity Directive

Date: 2026-07-01

Audience: Claude / next implementation agent.

Scope: simulator Q+N main chain, **LOFI comp texture only**. This is the follow-up
split out from `docs/mg_bass_comp_lead_fidelity_directive.md` §4. ACG per-bar
texture is already delivered (commit `e0d2c90`) and is NOT in scope here — do not
touch the ACG path.

## 0. Why LOFI is a separate task (do not skip)

The ACG per-bar texture fix (§4 of the bass/comp/lead directive) was a clean
wire-up: ACG's named piano gestures are **continuous** (comp fills the bar), so
switching texture every bar leaves no holes.

LOFI is **not** the same. LOFI textures are intentionally **sparse**
(`Piano_Lofi_OneShot_Space`, `Piano_Lofi_Late_Chord_Answer`, … — `partPolicy
chord: 'sparse'`, one or two comp hits per bar). A naive per-bar switch of sparse
LOFI textures produces `comp-continuity-gap` (comp silent > 2.5 beats), which is
**exactly the problem the section-level texture architecture was built to fix**
(see `docs/texture_switch_musicality_directive.md` — "伴奏自己断掉").

Evidence (2026-07-01): wiring LOFI through the ACG-style per-span picker raised
LOFI texture variety to MG-like levels (SIM 1-2 → 6-8, MG 4-5) but broke 9 tests:

```txt
musicalityAuditor.test.ts   : golden LOFI seeds now emit comp-continuity-gap
textureSwitchMusicality.test: LOFI comp gaps > 2.5 beats + section variety > 2
```

Those failures are **valid warnings**, not stale tests. Do not relax the auditor
or its thresholds to make them pass. The gap is real and audible.

Conclusion: LOFI "MG-like" requires texture **variety AND continuity bridging**
together. Variety alone regresses quality.

## 1. Non-Goal Guardrails

- Do NOT naive-per-bar LOFI (route LOFI through `pickAcgTextureForBar`-style
  per-span picking without bridging). That is the reverted approach.
- Do NOT relax `musicalityAuditor` `comp-continuity-gap` threshold
  (`COMP_GAP_BEATS.lofi = 2.5`) or the `textureSwitchMusicality` gap assertions.
- Do NOT change the ACG path.
- Do NOT touch pad/drum/lead. Comp texture only.
- Keep LOFI section-level until bridging is in place. Current state (LOFI section
  texture) is the safe fallback and must remain until this directive is done.

## 2. Required Approach: continuity bridging

MG achieves per-bar LOFI variety without audible holes. The simulator already has
the transition primitives — they are just not wired for a per-bar LOFI schedule:

- `knowledge/textureProfiles.ts`:
  - `rateTextureTransition(from, to)` → `{ rating, bridge }` where
    `bridge ∈ 'none' | 'carryTail' | 'pickupChord' | 'downbeatAnchor'`.
  - `TEXTURE_BEHAVIOR[...]` (`firstOnsetBeat`, `continuity`, `family`).
  - `DELAYED_ENTRY_TEXTURES` (firstOnsetBeat > 0.75).
- The section-level path already uses these (delayed-entry exclusion + in-section
  `richTextureSwitchBySection` with a downbeat-safe variant).

Required implementation:

1. Add a **bridge-aware per-bar LOFI picker** (mirror MG `pickLofiTextureForBar`,
   which is `pickTextureForBarWithGroove('LOFI', …)` + role fallback), but wrap it
   so that at each bar boundary:
   - compute `rateTextureTransition(prevTextureCase, pickedTextureCase)`;
   - if `bridge === 'downbeatAnchor'`: emit a light downbeat comp shell at the new
     bar's first beat (fills the entry hole for delayed/sparse textures);
   - if `bridge === 'carryTail'`: extend the previous texture's last comp voicing
     to the boundary before the new texture starts;
   - if `rating === 'avoid'`: re-pick or keep the previous texture for this bar.
2. Wire it into `render/textureSchedule.ts` as a **LOFI branch** parallel to the
   ACG branch (guarded, so ACG is untouched). The schedule must still be a
   `spanId → textureCase` map; the bridge decision may need to travel to the comp
   renderer (a per-span `bridge` hint), so consider extending `TextureSchedule` to
   `Record<string, { textureCase: string; bridge?: TextureBridge }>` OR carrying a
   separate `bridgeBySpan` map — pick the least invasive that the accompaniment
   renderer can consume.
3. `render/accompanimentRenderer.ts`: honor the bridge hint (downbeatAnchor shell /
   carryTail) so no `comp-continuity-gap` appears for LOFI.
4. Determinism: use the existing `rng.substream('compTexture')`; keep the draw
   count stable per seed. repeatGroup: source section gets the per-bar schedule;
   repeats replay rendered comp (unchanged mechanism).

## 3. Acceptance Criteria

Complete only when BOTH hold for LOFI (do not accept one without the other):

1. **Variety**: LOFI `textureSchedule` unique cases are MG-like — no longer
   collapsed to 1-2; target ≥ 4 (MG LOFI ≈ 4-5). Measure with
   `scripts/audit-mg-bass-comp-lead-fidelity.ts` (`texUniq MG/SIM` column) and a
   test in `render/mgBassCompLeadFidelity.test.ts` (LOFI variety ≥ 4).
2. **Continuity**: `musicalityAuditor` emits **no** `comp-continuity-gap` for the
   golden LOFI seeds, and `textureSwitchMusicality.test` LOFI cases pass (the
   "≤2 per section" assertion should be updated to reflect per-bar variety, but the
   comp-gap assertion must stay and must pass).
3. LOFI bass stays sparse/pocketed (do not densify to fill gaps — bridging is a
   light shell, not a busy bassline). ACG path unchanged. Lead untouched.
4. `npm test` + `npm run build` green.

## 4. Tests

- Extend `src/core/generation/newEngine/render/mgBassCompLeadFidelity.test.ts`:
  LOFI variety ≥ 4 AND LOFI comp has no gap-driven silent bar (or reuse the
  auditor's `comp-continuity-gap` finding == none for golden LOFI seeds).
- Keep `musicalityAuditor.test.ts` + `textureSwitchMusicality.test.ts` green;
  update only the stale "LOFI 段内织体 ≤2" assertion (which locked section-level),
  never the comp-gap assertion.

## 5. Reference

- Reverted naive attempt + rationale: commit `bda16dd`.
- ACG delivered path (the template that does NOT transfer to LOFI): commit
  `e0d2c90`, `render/textureSchedule.ts` ACG branch + `knowledge/textureProfiles.ts`
  `pickAcgTextureForBar`.
- MG source: `../melodygenerative/src/lib/musicEngine.ts`
  `pickLofiTextureForBar` / `lofiFallbackTextureForRole`, and MG's comp rendering
  of sparse textures (study how MG avoids audible holes).
- Continuity design origin: `docs/texture_switch_musicality_directive.md`.
