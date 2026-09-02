/**
 * Fold the original Fluoddity chrome into the culture-lab workstation.
 *
 * The old controls already own a lot of carefully tested behavior. Moving the
 * live nodes preserves every listener, shortcut and menu while letting the lab
 * present them as one instrument instead of a set of unrelated floating bars.
 */

import { ROTATION_STEP, type CameraState } from '../camera/cameraState.ts';
import {
  DISH_ROTATION_EVENT,
  rotateDishBy,
  setDishRotation,
} from './dishOrientation.ts';
import {
  announceWorkspaceDrawer,
  closeWhenWorkspaceDrawerChanges,
} from '../ui/workspaceDrawer.ts';

const MENU_LABELS: Readonly<Record<string, string>> = Object.freeze({
  File: 'Project',
  Share: 'Share',
  History: 'History',
  Editor: 'Settings',
  Simulation: 'Run',
  Help: 'Help',
});

const CULTURE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M3.5 3.5h17v17h-17z"></path>' +
    '<circle cx="12" cy="12" r="6.3"></circle>' +
    '<circle cx="9.3" cy="10.1" r="1"></circle>' +
    '<circle cx="14.8" cy="11.4" r=".8"></circle>' +
    '<circle cx="12.2" cy="15.1" r="1.15"></circle>' +
  '</svg>';

function block(label: string, index: string, className: string): HTMLDivElement {
  const root = document.createElement('div');
  root.className = className;

  const heading = document.createElement('div');
  heading.className = 'culture-console-label';
  heading.innerHTML = `<b>${index}</b><span>${label}</span>`;
  root.append(heading);
  return root;
}

function arrangeMutationControls(mutation: HTMLElement): void {
  const bar = mutation.querySelector<HTMLElement>('#fluoddity-mutation-bar');
  if (bar === null || bar.dataset['cultureArranged'] === 'true') return;

  const controls = Array.from(bar.children);
  if (controls.length < 9) return;
  const [layouts, scaleLabel, scale, readout, rerollAll, rerollMutations, reset, tool, panels] =
    controls as HTMLElement[];
  if (
    layouts === undefined ||
    scaleLabel === undefined ||
    scale === undefined ||
    readout === undefined ||
    rerollAll === undefined ||
    rerollMutations === undefined ||
    reset === undefined ||
    tool === undefined ||
    panels === undefined
  ) {
    return;
  }

  const population = block('Cohort array', '02.A', 'culture-control-block culture-population');
  const populationBody = document.createElement('div');
  populationBody.className = 'culture-population-body';
  populationBody.append(layouts);
  population.append(populationBody);

  const variation = block('Variation envelope', '02.B', 'culture-control-block culture-variation');
  const variationHead = document.createElement('div');
  variationHead.className = 'culture-variation-head';
  variationHead.append(scaleLabel, readout);
  variation.append(variationHead, scale);

  const actions = block('Lineage procedure', '02.C', 'culture-control-block culture-actions');
  const actionBody = document.createElement('div');
  actionBody.className = 'culture-action-body';
  rerollAll.classList.add('culture-primary-action');
  rerollMutations.classList.add('culture-primary-action');
  reset.classList.add('culture-reset-action');
  actionBody.append(rerollAll, rerollMutations, reset);
  actions.append(actionBody);

  const mode = block('Manipulation mode', '02.D', 'culture-control-block culture-mode');
  const modeBody = document.createElement('div');
  modeBody.className = 'culture-mode-body';
  modeBody.append(tool);
  panels.id = 'fluoddity-settings-launcher';
  document.body.append(panels);
  mode.append(modeBody);

  bar.replaceChildren(population, variation, actions, mode);
  bar.dataset['cultureArranged'] = 'true';

  const context = mutation.children.item(1);
  if (context instanceof HTMLElement) context.classList.add('culture-context');
}

/** Touch keeps its compact mutation bar, but Settings belongs in the launcher dock. */
function detachMobileSettingsLauncher(mutation: HTMLElement): void {
  const launcher = mutation.querySelector<HTMLElement>(
    '[data-setting="transport.toggleUi"]',
  );
  if (launcher === null) return;
  launcher.id = 'fluoddity-settings-launcher';
  document.body.append(launcher);
}

function dishOrientation(camera: CameraState): HTMLDivElement {
  const root = block('Dish orientation', '01.B', 'culture-control-block culture-orientation');
  const controls = document.createElement('div');
  controls.className = 'culture-orientation-controls';

  const left = document.createElement('button');
  left.type = 'button';
  left.textContent = '−15°';
  left.setAttribute('aria-label', 'Rotate dish counter-clockwise 15 degrees');

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '-180';
  slider.max = '180';
  slider.step = '1';
  slider.setAttribute('aria-label', 'Dish orientation in degrees');

  const right = document.createElement('button');
  right.type = 'button';
  right.textContent = '+15°';
  right.setAttribute('aria-label', 'Rotate dish clockwise 15 degrees');

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'culture-orientation-reset';
  reset.textContent = 'ZERO';
  reset.setAttribute('aria-label', 'Reset dish orientation');

  const readout = document.createElement('output');
  const sync = (): void => {
    const degrees = Math.round((camera.rotation * 180) / Math.PI);
    slider.value = String(degrees);
    readout.value = `${degrees >= 0 ? '+' : ''}${degrees}°`;
  };
  left.addEventListener('click', () => {
    rotateDishBy(camera, ROTATION_STEP);
    sync();
  });
  right.addEventListener('click', () => {
    rotateDishBy(camera, -ROTATION_STEP);
    sync();
  });
  slider.addEventListener('input', () => {
    setDishRotation(camera, (Number(slider.value) * Math.PI) / 180);
    sync();
  });
  reset.addEventListener('click', () => {
    setDishRotation(camera, 0);
    sync();
  });
  window.addEventListener(DISH_ROTATION_EVENT, sync);

  controls.append(left, slider, right, reset, readout);
  root.append(controls);
  sync();
  return root;
}

/** Install the culture console once. Touch keeps its purpose-built mutation bar. */
export function installCultureConsole(mobile: boolean, camera: CameraState): void {
  if (document.getElementById('fluoddity-control-rack') !== null) return;

  const menu = document.getElementById('fluoddity-menubar');
  const mutation = document.getElementById('fluoddity-mutation');
  const fps = document.getElementById('fluoddity-fps');
  const physics = document.getElementById('fluoddity-physics');
  if (menu === null || mutation === null || fps === null || physics === null) return;

  document.documentElement.classList.add('fluoddity-console');

  const rack = document.createElement('aside');
  rack.id = 'fluoddity-control-rack';
  rack.classList.toggle('is-mobile', mobile);
  rack.setAttribute('aria-label', 'Culture procedure controls');
  rack.innerHTML =
    '<header class="culture-console-head">' +
      '<button class="culture-console-mark culture-console-toggle" type="button" ' +
        'aria-label="Collapse culture controls" aria-expanded="true">' +
        CULTURE_ICON +
      '</button>' +
      '<span><small>PROCEDURE CONTROL / NODE 01</small><strong>Culture operations</strong></span>' +
      '<code>01</code>' +
    '</header>' +
    '<div class="culture-console-state">' +
      '<span><i></i>VESSEL SEALED</span><code>F-32 / LIVE</code>' +
    '</div>';

  const commands = block('System commands', '01', 'culture-console-section culture-commands');
  const commandHost = document.createElement('div');
  commandHost.className = 'culture-console-host';
  commandHost.append(menu);
  commands.append(commandHost);

  const orientation = mobile ? null : dishOrientation(camera);
  orientation?.classList.add('culture-console-section', 'culture-vessel');

  let manipulation: HTMLDivElement | null = null;
  if (!mobile) {
    manipulation = block(
      'Lineage manipulation',
      '02',
      'culture-console-section culture-manipulation',
    );
    const manipulationHost = document.createElement('div');
    manipulationHost.className = 'culture-console-host';
    arrangeMutationControls(mutation);
    manipulationHost.append(mutation);
    manipulation.append(manipulationHost);
  } else {
    detachMobileSettingsLauncher(mutation);
  }

  const telemetry = block('Run telemetry', '03', 'culture-console-section culture-telemetry');
  const telemetryHost = document.createElement('div');
  telemetryHost.className = 'culture-telemetry-host';
  telemetryHost.append(fps, physics);
  telemetry.append(telemetryHost);

  const footer = document.createElement('footer');
  footer.innerHTML =
    '<a href="https://github.com/aphid91/Fluoddity-Web" target="_blank" rel="noreferrer">' +
      '<span>FLUODDITY-WEB</span><small>JESSE GELDERS · ORIGINAL ENGINE</small>' +
    '</a><code>MIT</code>';
  rack.append(commands);
  if (orientation !== null) rack.append(orientation);
  if (manipulation !== null) rack.append(manipulation);
  rack.append(telemetry, footer);
  document.body.append(rack);

  const collapse = rack.querySelector<HTMLButtonElement>('.culture-console-toggle');
  const launcher = document.createElement('button');
  launcher.id = 'fluoddity-culture-launcher';
  launcher.className = 'workspace-launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-controls', rack.id);
  launcher.innerHTML = CULTURE_ICON;
  document.body.append(launcher);

  const setCollapsed = (collapsed: boolean): void => {
    rack.classList.toggle('is-collapsed', collapsed);
    launcher.setAttribute('aria-expanded', String(!collapsed));
    launcher.setAttribute('aria-pressed', String(!collapsed));
    launcher.title = collapsed ? 'Open culture controls' : 'Collapse culture controls';
    launcher.setAttribute('aria-label', launcher.title);
    if (collapse === null) return;
    collapse.setAttribute('aria-expanded', String(!collapsed));
    collapse.title = collapsed ? 'Open culture controls' : 'Collapse culture controls';
    collapse.setAttribute(
      'aria-label',
      collapsed ? 'Open culture controls' : 'Collapse culture controls',
    );
  };
  collapse?.addEventListener('click', () => {
    const collapsed = !rack.classList.contains('is-collapsed');
    setCollapsed(collapsed);
    if (!collapsed) announceWorkspaceDrawer('culture');
  });
  launcher.addEventListener('click', () => {
    const collapsed = !rack.classList.contains('is-collapsed');
    setCollapsed(collapsed);
    if (!collapsed) announceWorkspaceDrawer('culture');
  });
  // Keep the culture observable on every viewport; its launcher is always one
  // click away and expands to the same control surface.
  setCollapsed(true);
  closeWhenWorkspaceDrawerChanges('culture', () => setCollapsed(true));

  for (const button of menu.querySelectorAll<HTMLButtonElement>(':scope > div > button')) {
    const original = button.textContent?.trim() ?? '';
    button.dataset['originalLabel'] = original;
    button.textContent = MENU_LABELS[original] ?? original;
  }
}
