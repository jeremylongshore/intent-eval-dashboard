/**
 * Per-skill signals module public surface (wave-2 — bead ig4h.6).
 *
 * The public `/skills/` generator: consumes verified kernel entities
 * (`@intentsolutions/core` `UsageEvent` + `HumanReview`) through a clean
 * resolver seam, builds PER-SKILL, PER-DIMENSION cards, and emits self-contained
 * HTML pages. C3-SAFE by construction: the view-model has no aggregate field and
 * the renderer has no cross-dimension reducer — there is no rolled "skill score"
 * anywhere.
 *
 * NOTE: `pathFromUrl` (in `generate-skills.ts`) is intentionally NOT re-exported
 * here — it collides by name with the results module's helper and is internal to
 * the skills CLI entrypoint. Import it directly from `./generate-skills.js` if
 * ever needed in-module.
 */

// --- view-model + resolver seam ---
export {
  buildAdoptionSignal,
  buildHumanTrustSignal,
  buildQualitySignal,
  buildSkillCard,
  buildSkillsView,
  HUMAN_REVIEW_PREDICATE_URI,
  QUALITY_PREDICATE_URI,
  USAGE_PREDICATE_URI,
  type AdoptionMeterCount,
  type AdoptionSignal,
  type HumanTrustSignal,
  type QualitySignal,
  type SignalProvenance,
  type SkillCard,
  type SkillSignalResolver,
  type SkillSignals,
  type SkillsView,
} from './skill-signal-model.js';

// --- HTML rendering (public, per-dimension only) ---
export {
  renderAdoptionPanel,
  renderHumanTrustPanel,
  renderQualityPanel,
  renderSkillCard,
  renderSkillPage,
  renderSkillsIndex,
  skillsAsOfBanner,
  skillUrl,
} from './render-skills.js';

// --- generator (public, data → site/) ---
export {
  buildSkillsFiles,
  generateSkillsFiles,
  writeSkillsSite,
  type GeneratedSkillFile,
} from './generate-skills.js';
