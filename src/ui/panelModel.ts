/**
 * Which sections each panel shows, and in what order.
 *
 * ## One drawer, grouped by what the state IS
 *
 * `ARCHITECTURE.md`'s "Toolbar and the planned side-panel" named an endpoint the
 * desktop never reached: the active tool selecting which controls are visible,
 * hosted in a docked panel rather than in floating windows. This is that
 * endpoint, arrived at by a different route than "one panel" -- because the
 * controls turn out to divide on something more fundamental than the tool.
 *
 * **Project is a different KIND of state from the rest.** It is the config: the
 * thing you save, load and share. Preferences and Drawing Controls are how your
 * editor is set up, and loading someone else's config must not touch them
 * (`preferences_window.py:12-16`). That split already existed in the registry as
 * `source`; it now defines the tabs inside one settings drawer. Project comes
 * first, followed by editor state.
 *
 * The tool selection endpoint survives inside that: the right panel's two
 * sections became TABS rather than stacked folders, and the active tab follows
 * the tool. See `sections/settingsSection.ts`. It is a tab decision rather than
 * a section decision, which is why it is not made in this file -- there is no
 * `mode` parameter here any more, and nothing needs one.
 *
 * ## Transport and Debug are PARKED
 *
 * Not deleted: `transportSection.ts` and `debugSection.ts` are untouched, their
 * ids are still exported, `buildSection` still dispatches to them, and their
 * tests still run. They are simply not in either list today. Restoring one is a
 * single line here and nothing else.
 *
 * Everything Transport carried is reachable elsewhere -- Pause and the camera
 * from the Simulation and View menus, the tool from Editor > Tools and the
 * `1`/`2`/`3` keys, and the active tool is displayed by the mutation overlay so
 * a modal tool is never invisible. Debug is a developer readout that the
 * `?debug` overlay also covers.
 */

/**
 * A panel section's stable identity.
 *
 * Used as the `data-section` attribute on the folder element, so `uiCheck.mjs`
 * can find a section without depending on its title or on Tweakpane's minified
 * class names.
 */
export const TRANSPORT = 'transport';
export const PROJECT = 'project';
export const PREFERENCES = 'preferences';
export const DRAWING = 'drawing';
export const DEBUG = 'debug';
/** The right panel's tabbed host. Owns PREFERENCES and DRAWING as its pages. */
export const SETTINGS = 'settings';

export type SectionId =
  | typeof TRANSPORT
  | typeof PROJECT
  | typeof PREFERENCES
  | typeof DRAWING
  | typeof DEBUG
  | typeof SETTINGS;

export interface PanelSection {
  readonly id: SectionId;
  /** The folder title. */
  readonly title: string;
  /** Whether the folder starts open. */
  readonly expanded: boolean;
}

/**
 * The right panel: editor state, behind two tabs.
 *
 * PARKED, and deliberately still written out:
 *   { id: DEBUG, title: 'Debug', expanded: false },
 */
const RIGHT_SECTIONS: readonly PanelSection[] = [
  { id: SETTINGS, title: 'Settings', expanded: true },
];

/**
 * The left panel's sections, in display order.
 *
 * **EMPTY ON EVERY VIEWPORT.** Project moved into the settings tab strip so the
 * culture vessel never has two editor columns competing with its lab drawers.
 *
 * Returning an empty list rather than never calling this is deliberate: the
 * panel's build loop, refresh, dispose and hidden-state handling all stay
 * exactly as they are and simply iterate nothing. The alternative -- a `null`
 * side threaded through every one of those -- would put a branch in each.
 */
export function leftSections(_mobile = false): readonly PanelSection[] {
  return [];
}

/**
 * The right panel's sections, in display order.
 *
 * The single tabbed host used on every viewport.
 */
export function rightSections(): readonly PanelSection[] {
  return RIGHT_SECTIONS;
}
