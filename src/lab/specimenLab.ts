import type { CommandBus, Status } from '../orchestrator/commands.ts';
import type { CameraState } from '../camera/cameraState.ts';
import {
  announceWorkspaceDrawer,
  closeWhenWorkspaceDrawerChanges,
  dismissWorkspaceDrawers,
} from '../ui/workspaceDrawer.ts';
import { worldToScreenNdc } from '../particleSystem/coords.ts';
import { captureRegion, imageToCanvas } from '../ui/shareCapture.ts';
import {
  MAX_ARENA_SPECIMENS,
  MAX_SPECIMENS,
  buildSpecimenArena,
  createSpecimen,
  editSpecimen,
  loadSpecimens,
  saveSpecimens,
  specimenSourceWithRule,
  type Specimen,
  type SpecimenSource,
} from './specimens.ts';
import {
  rotateDishBy,
  rotationFromBearingDrag,
  setDishRotation,
} from './dishOrientation.ts';
import './specimenLab.css';

export interface SpecimenLabOptions {
  readonly bus: CommandBus;
  readonly canvas: HTMLCanvasElement;
  readonly camera: () => CameraState;
  readonly canvasSize: () => readonly [number, number];
}

const SPECIMEN_ICON =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M3.5 3.5h17v17h-17z"></path>' +
    '<path d="M7 5.5l10 4.2-10 4.6 10 4.2M17 5.5L7 9.7l10 4.6-10 4.2"></path>' +
    '<path d="M9.5 7h5M8.2 12h7.6M9.5 17h5"></path>' +
  '</svg>';

function button(label: string, className: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  return el;
}

async function captureThumbnail(canvas: HTMLCanvasElement): Promise<string | undefined> {
  try {
    const box = canvas.getBoundingClientRect();
    const captured = await captureRegion(canvas, {
      x: 0,
      y: 0,
      width: box.width,
      height: box.height,
    });
    const source = imageToCanvas(captured);
    const width = 320;
    const height = 180;
    const target = document.createElement('canvas');
    target.width = width;
    target.height = height;
    const context = target.getContext('2d');
    if (context === null || source.width < 2 || source.height < 2) return undefined;

    const sourceAspect = source.width / source.height;
    const targetAspect = width / height;
    let sx = 0;
    let sy = 0;
    let sw = source.width;
    let sh = source.height;
    if (sourceAspect > targetAspect) {
      sw = source.height * targetAspect;
      sx = (source.width - sw) / 2;
    } else {
      sh = source.width / targetAspect;
      sy = (source.height - sh) / 2;
    }
    context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
    const image = target.toDataURL('image/jpeg', 0.76);
    return image.startsWith('data:image/') ? image : undefined;
  } catch {
    // Some WebGPU implementations do not expose the current swap-chain image
    // to drawImage. The deterministic fingerprint artwork is the fallback.
    return undefined;
  }
}

function huePair(fingerprint: string): readonly [number, number] {
  const seed = Number.parseInt(fingerprint.slice(-8), 16) >>> 0;
  return [seed % 360, (seed * 7 + 113) % 360];
}

function shortDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function pointerAngle(event: PointerEvent, center: readonly [number, number]): number {
  return Math.atan2(event.clientY - center[1], event.clientX - center[0]);
}

function cohortCount(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(64, Math.round(parsed))) : fallback;
}

/** The naturalist layer around the existing select-and-mutate simulation. */
export class SpecimenLab {
  private readonly bus: CommandBus;
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: () => CameraState;
  private readonly canvasSize: () => readonly [number, number];
  private readonly stage: HTMLElement;
  private readonly dish: HTMLElement;
  private readonly orientationHandle: HTMLButtonElement;
  private readonly cohortPalette: HTMLElement;
  private readonly cohortPaletteTitle: HTMLElement;
  private readonly cohortSave: HTMLButtonElement;
  private readonly cohortCountInput: HTMLInputElement;
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly shelf: HTMLElement;
  private readonly project: HTMLElement;
  private readonly generation: HTMLElement;
  private readonly instruction: HTMLElement;
  private readonly shelfCount: HTMLElement;
  private readonly captureButton: HTMLButtonElement;
  private readonly seedButton: HTMLButtonElement;
  private readonly variation: HTMLInputElement;
  private readonly variationReadout: HTMLOutputElement;
  private readonly toast: HTMLElement;
  private readonly dialog: HTMLDialogElement;
  private readonly dialogTitle: HTMLElement;
  private readonly dialogPreview: HTMLElement;
  private readonly dialogMeta: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly notesInput: HTMLTextAreaElement;
  private storage: Storage | null = null;
  private specimens: Specimen[] = [];
  private readonly chosen = new Set<string>();
  private pendingSource: SpecimenSource | null = null;
  private editingId: string | null = null;
  private lastGeneration = -1;
  private lastHighlightedCohort = -1;
  private latestStatus: Status | null = null;
  private toastTimer = 0;

  constructor(opts: SpecimenLabOptions) {
    this.bus = opts.bus;
    this.canvas = opts.canvas;
    this.camera = opts.camera;
    this.canvasSize = opts.canvasSize;
    try {
      this.storage = window.localStorage;
      this.specimens = [...loadSpecimens(this.storage)];
    } catch {
      this.storage = null;
    }

    // The canvas is clipped into a circle, which also clips its browser hit
    // region. This transparent workspace owns stage gestures across the pale
    // area while leaving every real control above it clickable.
    this.stage = document.createElement('div');
    this.stage.id = 'fluoddity-stage-input';
    this.stage.setAttribute('aria-hidden', 'true');
    document.body.append(this.stage);

    this.dish = document.createElement('div');
    this.dish.id = 'fluoddity-petri-dish';
    this.dish.setAttribute('aria-hidden', 'true');
    this.dish.innerHTML =
      '<i class="dish-bearing"></i>' +
      '<span class="dish-id">CULTURE VESSEL / 01</span>' +
      '<span class="dish-state"><i></i>CONTAINMENT ACTIVE</span>' +
      '<span class="dish-scale">Ø 0.86 · SEALED FIELD</span>';
    document.body.append(this.dish);

    this.orientationHandle = document.createElement('button');
    this.orientationHandle.id = 'fluoddity-dish-orient';
    this.orientationHandle.type = 'button';
    this.orientationHandle.title = 'Drag to rotate the dish';
    this.orientationHandle.setAttribute('aria-label', 'Drag to rotate the dish');
    this.orientationHandle.innerHTML = '<span aria-hidden="true"></span>';
    this.bindOrientationHandle();
    document.body.append(this.orientationHandle);

    this.cohortPalette = document.createElement('aside');
    this.cohortPalette.id = 'fluoddity-cohort-actions';
    this.cohortPalette.hidden = true;
    this.cohortPalette.setAttribute('aria-label', 'Selected cohort actions');
    const cohortHead = document.createElement('header');
    const cohortEyebrow = document.createElement('span');
    cohortEyebrow.textContent = 'ISOLATED COHORT';
    this.cohortPaletteTitle = document.createElement('strong');
    const cohortClose = button('×', 'cohort-action-close');
    cohortClose.setAttribute('aria-label', 'Cancel cohort selection');
    cohortClose.addEventListener('click', () => this.bus.dispatch({ kind: 'cancelSelection' }));
    cohortHead.append(cohortEyebrow, this.cohortPaletteTitle, cohortClose);

    const directActions = document.createElement('div');
    directActions.className = 'cohort-direct-actions';
    this.cohortSave = button('Save', 'cohort-save');
    this.cohortSave.addEventListener('click', () => void this.openSelectedCapture());
    const mutate = button('Mutate', 'cohort-mutate');
    mutate.addEventListener('click', () => this.bus.dispatch({ kind: 'confirmSelection' }));
    directActions.append(this.cohortSave, mutate);

    const cohortPlan = document.createElement('section');
    const cohortPlanTitle = document.createElement('strong');
    cohortPlanTitle.textContent = 'NEW COHORT ARRAY';
    const countLabel = document.createElement('label');
    countLabel.textContent = 'How many?';
    const stepper = document.createElement('div');
    stepper.className = 'cohort-count-stepper';
    const less = button('−', 'cohort-count-less');
    less.setAttribute('aria-label', 'Use one fewer cohort');
    this.cohortCountInput = document.createElement('input');
    this.cohortCountInput.type = 'number';
    this.cohortCountInput.min = '1';
    this.cohortCountInput.max = '64';
    this.cohortCountInput.step = '1';
    this.cohortCountInput.inputMode = 'numeric';
    this.cohortCountInput.setAttribute('aria-label', 'How many cohorts');
    const more = button('+', 'cohort-count-more');
    more.setAttribute('aria-label', 'Use one more cohort');
    const step = (delta: number): void => {
      const fallback = this.latestStatus?.cohortCount ?? 1;
      this.cohortCountInput.value = String(
        cohortCount(this.cohortCountInput.value, fallback) + delta,
      );
      this.cohortCountInput.value = String(
        cohortCount(this.cohortCountInput.value, fallback),
      );
    };
    less.addEventListener('click', () => step(-1));
    more.addEventListener('click', () => step(1));
    stepper.append(less, this.cohortCountInput, more);
    countLabel.append(stepper);
    const restart = button('Restart dish', 'cohort-restart');
    restart.addEventListener('click', () => {
      const fallback = this.latestStatus?.cohortCount ?? 1;
      const cohorts = cohortCount(this.cohortCountInput.value, fallback);
      this.cohortCountInput.value = String(cohorts);
      this.bus.dispatch({ kind: 'cancelSelection' });
      this.bus.dispatch({ kind: 'setPopulationLayout', cohorts });
    });
    cohortPlan.append(cohortPlanTitle, countLabel, restart);
    this.cohortPalette.append(cohortHead, directActions, cohortPlan);
    document.body.append(this.cohortPalette);
    this.bindStageDismissal();

    const startsCollapsed = true;
    this.root = document.createElement('aside');
    this.root.id = 'fluoddity-specimen-lab';
    this.root.classList.toggle('is-collapsed', startsCollapsed);
    this.root.setAttribute('aria-label', 'Specimen laboratory');

    const header = document.createElement('header');
    header.className = 'lab-header';
    const heading = document.createElement('div');
    heading.className = 'lab-heading';
    heading.innerHTML =
      '<button class="lab-mark lab-toggle" type="button" aria-label="Collapse specimen shelf" aria-expanded="true">' +
        SPECIMEN_ICON +
      '</button>' +
      '<span><small>SPECIMEN ARCHIVE / NODE 02</small><strong>Lineage registry</strong></span>';
    this.shelfCount = document.createElement('span');
    this.shelfCount.className = 'lab-count';
    const collapse = heading.querySelector<HTMLButtonElement>('.lab-toggle')!;
    const launcher = document.createElement('button');
    launcher.id = 'fluoddity-specimen-launcher';
    launcher.className = 'workspace-launcher';
    launcher.type = 'button';
    launcher.setAttribute('aria-controls', this.root.id);
    launcher.innerHTML = SPECIMEN_ICON;

    const setCollapsed = (collapsed: boolean): void => {
      this.root.classList.toggle('is-collapsed', collapsed);
      const label = collapsed ? 'Open specimen shelf' : 'Collapse specimen shelf';
      collapse.title = label;
      collapse.setAttribute('aria-label', label);
      collapse.setAttribute('aria-expanded', String(!collapsed));
      launcher.title = label;
      launcher.setAttribute('aria-label', label);
      launcher.setAttribute('aria-expanded', String(!collapsed));
      launcher.setAttribute('aria-pressed', String(!collapsed));
    };
    collapse.addEventListener('click', () => {
      const collapsed = !this.root.classList.contains('is-collapsed');
      setCollapsed(collapsed);
      if (!collapsed) announceWorkspaceDrawer('specimens');
    });
    launcher.addEventListener('click', () => {
      const collapsed = !this.root.classList.contains('is-collapsed');
      setCollapsed(collapsed);
      if (!collapsed) announceWorkspaceDrawer('specimens');
    });
    closeWhenWorkspaceDrawerChanges('specimens', () => setCollapsed(true));
    setCollapsed(startsCollapsed);
    header.append(heading, this.shelfCount);

    this.body = document.createElement('div');
    this.body.className = 'lab-body';

    const flow = document.createElement('div');
    flow.className = 'lab-flow';
    for (const [number, label] of [
      ['01', 'OBSERVE'],
      ['02', 'ISOLATE'],
      ['03', 'ARCHIVE'],
      ['04', 'INOCULATE'],
    ] as const) {
      const step = document.createElement('span');
      step.innerHTML = `<b>${number}</b>${label}`;
      flow.append(step);
    }

    const live = document.createElement('section');
    live.className = 'lab-live';
    const liveTop = document.createElement('div');
    liveTop.className = 'lab-live-top';
    const status = document.createElement('div');
    status.className = 'lab-live-status';
    this.project = document.createElement('strong');
    this.generation = document.createElement('span');
    status.append(this.project, this.generation);
    this.captureButton = button('Archive lineage', 'lab-capture');
    this.captureButton.addEventListener('click', () => void this.openCapture());
    liveTop.append(status, this.captureButton);
    this.instruction = document.createElement('p');
    this.instruction.className = 'lab-instruction';
    live.append(liveTop, this.instruction);

    const arena = document.createElement('section');
    arena.className = 'lab-arena';
    const arenaCopy = document.createElement('div');
    arenaCopy.className = 'lab-arena-copy';
    arenaCopy.innerHTML =
      '<strong>Prepare culture</strong><span>Select up to eight records. Each becomes an isolated founding population.</span>';
    const variationLabel = document.createElement('label');
    variationLabel.className = 'lab-variation';
    const variationText = document.createElement('span');
    variationText.textContent = 'Offspring variation';
    this.variationReadout = document.createElement('output');
    this.variation = document.createElement('input');
    this.variation.type = 'range';
    this.variation.min = '0';
    this.variation.max = '0.6';
    this.variation.step = '0.001';
    this.variation.value = '0.12';
    this.variation.setAttribute('aria-label', 'Offspring variation');
    this.variation.addEventListener('input', () => this.syncVariation());
    variationLabel.append(variationText, this.variationReadout, this.variation);
    this.seedButton = button('Inoculate', 'lab-seed');
    this.seedButton.disabled = true;
    this.seedButton.addEventListener('click', () => this.seedArena());
    arena.append(arenaCopy, variationLabel, this.seedButton);

    const shelfLabel = document.createElement('div');
    shelfLabel.className = 'lab-shelf-label';
    shelfLabel.innerHTML = '<span>ARCHIVED SPECIMENS</span><i>LOCAL REGISTRY</i>';
    this.shelf = document.createElement('div');
    this.shelf.className = 'lab-shelf';
    this.shelf.setAttribute('aria-live', 'polite');

    this.toast = document.createElement('div');
    this.toast.className = 'lab-toast';
    this.toast.setAttribute('role', 'status');
    this.body.append(flow, live, arena, shelfLabel, this.shelf);
    const attribution = document.createElement('footer');
    attribution.className = 'lab-attribution';
    attribution.innerHTML =
      '<span>SIMULATION FOUNDATION</span>' +
      '<a href="https://github.com/aphid91/Fluoddity-Web" target="_blank" rel="noreferrer">' +
        '<strong>Fluoddity-Web</strong><small>Jesse Gelders · MIT License ↗</small>' +
      '</a>';
    this.root.append(header, this.body, attribution, this.toast);
    document.body.append(this.root, launcher);

    this.dialog = document.createElement('dialog');
    this.dialog.className = 'specimen-dialog';
    const form = document.createElement('form');
    form.method = 'dialog';
    const dialogHead = document.createElement('div');
    dialogHead.className = 'specimen-dialog-head';
    const dialogHeading = document.createElement('div');
    dialogHeading.innerHTML = '<small>CULTURE ARCHIVE / NEW RECORD</small>';
    this.dialogTitle = document.createElement('h2');
    dialogHeading.append(this.dialogTitle);
    const cancel = button('×', 'specimen-dialog-close');
    cancel.setAttribute('aria-label', 'Close specimen record');
    cancel.addEventListener('click', () => this.dialog.close());
    dialogHead.append(dialogHeading, cancel);
    this.dialogPreview = document.createElement('div');
    this.dialogPreview.className = 'specimen-dialog-preview';
    this.dialogMeta = document.createElement('span');
    this.dialogPreview.append(this.dialogMeta);
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Specimen name';
    this.nameInput = document.createElement('input');
    this.nameInput.required = true;
    this.nameInput.maxLength = 80;
    this.nameInput.autocomplete = 'off';
    nameLabel.append(this.nameInput);
    const notesLabel = document.createElement('label');
    notesLabel.textContent = 'Field notes';
    this.notesInput = document.createElement('textarea');
    this.notesInput.maxLength = 2_000;
    this.notesInput.rows = 4;
    this.notesInput.placeholder = 'What made this one worth keeping? Shape, motion, lineage…';
    notesLabel.append(this.notesInput);
    const dialogActions = document.createElement('div');
    dialogActions.className = 'specimen-dialog-actions';
    const discard = button('Cancel', 'specimen-dialog-cancel');
    discard.addEventListener('click', () => this.dialog.close());
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'specimen-dialog-save';
    save.textContent = 'Archive specimen';
    dialogActions.append(discard, save);
    form.append(dialogHead, this.dialogPreview, nameLabel, notesLabel, dialogActions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.saveDialog();
    });
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.dialog.close();
    });
    this.dialog.append(form);
    document.body.append(this.dialog);

    this.syncVariation();
    this.renderShelf();
  }

  /**
   * Blank stage space is the natural escape target on both touch and desktop.
   * Keep the dish itself interactive: only points outside its circular rim
   * dismiss drawers and the selected-cohort palette.
   */
  private bindStageDismissal(): void {
    this.stage.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const rect = this.dish.getBoundingClientRect();
      const radius = Math.min(rect.width, rect.height) / 2;
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      if (dx * dx + dy * dy <= radius * radius) return;

      dismissWorkspaceDrawers();
      if (!this.cohortPalette.hidden) this.bus.dispatch({ kind: 'cancelSelection' });
    });
  }

  refresh(status: Status): void {
    this.latestStatus = status;
    this.syncDishView();
    this.syncCohortPalette(status);
    this.project.textContent = status.projectName;
    this.generation.textContent =
      status.lineageGeneration === 0
        ? `${status.configCount} founding ${status.configCount === 1 ? 'lineage' : 'lineages'}`
        : `generation ${String(status.lineageGeneration).padStart(2, '0')}`;

    if (status.lineageGeneration !== this.lastGeneration) {
      if (this.lastGeneration >= 0) {
        this.generation.classList.remove('just-bred');
        // Force the class to restart even when two generations land quickly.
        void this.generation.offsetWidth;
        this.generation.classList.add('just-bred');
      }
      this.lastGeneration = status.lineageGeneration;
    }

    if (status.selectionIsNoOp) {
      this.instruction.textContent =
        'These cohorts are clonal. Raise Mutation Scale above zero before breeding a child.';
    } else if (status.highlightedCohort >= 0) {
      this.instruction.textContent =
        `Cohort ${status.highlightedCohort + 1} is isolated. ` +
        'Confirm Generate descendants—or press Enter—to breed its rule.';
    } else if (status.configCount > 1) {
      this.instruction.textContent =
        `${status.configCount} saved lineages share this dish. Click an organism to isolate its cohort.`;
    } else {
      this.instruction.textContent =
        'Observe the vessel. Select an organism to isolate its cohort, then confirm generation.';
    }
  }

  private syncDishView(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const camera = this.camera();
    const framebuffer: readonly [number, number] = [this.canvas.width, this.canvas.height];
    const ndc = worldToScreenNdc(
      [0, 0],
      this.canvasSize(),
      framebuffer,
      camera.pan,
      camera.zoom,
      camera.rotation,
    );
    const localX = ((ndc[0] + 1) * rect.width) / 2;
    const localY = ((1 - ndc[1]) * rect.height) / 2;
    const radius = 0.43 * Math.min(rect.width, rect.height) * camera.zoom;

    this.canvas.style.clipPath = `circle(${radius}px at ${localX}px ${localY}px)`;
    this.stage.dataset['tool'] = this.canvas.dataset['tool'] ?? 'select';
    this.dish.style.left = `${rect.left + localX}px`;
    this.dish.style.top = `${rect.top + localY}px`;
    this.dish.style.width = `${radius * 2}px`;
    this.dish.style.setProperty('--lab-dish-rotation', `${-camera.rotation}rad`);

    const bearing = -camera.rotation - Math.PI / 2;
    const reach = radius + 14;
    this.orientationHandle.style.left = `${rect.left + localX + Math.cos(bearing) * reach}px`;
    this.orientationHandle.style.top = `${rect.top + localY + Math.sin(bearing) * reach}px`;
    this.orientationHandle.setAttribute(
      'aria-label',
      `Drag to rotate the dish. Current orientation ${Math.round((camera.rotation * 180) / Math.PI)} degrees`,
    );
  }

  private bindOrientationHandle(): void {
    let pointerId: number | null = null;
    let center: readonly [number, number] = [0, 0];
    let startPointerAngle = 0;
    let startRotation = 0;

    const finish = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      this.orientationHandle.classList.remove('is-dragging');
    };

    this.orientationHandle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || pointerId !== null) return;
      event.preventDefault();
      event.stopPropagation();
      const dishRect = this.dish.getBoundingClientRect();
      center = [dishRect.left + dishRect.width / 2, dishRect.top + dishRect.height / 2];
      startPointerAngle = pointerAngle(event, center);
      startRotation = this.camera().rotation;
      pointerId = event.pointerId;
      this.orientationHandle.classList.add('is-dragging');
      this.orientationHandle.setPointerCapture(event.pointerId);
    });
    this.orientationHandle.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      const next = rotationFromBearingDrag(
        startRotation,
        startPointerAngle,
        pointerAngle(event, center),
      );
      setDishRotation(this.camera(), next);
    });
    this.orientationHandle.addEventListener('pointerup', finish);
    this.orientationHandle.addEventListener('pointercancel', finish);
    this.orientationHandle.addEventListener('keydown', (event) => {
      const camera = this.camera();
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        rotateDishBy(camera, event.key === 'ArrowLeft' ? Math.PI / 36 : -Math.PI / 36);
      } else if (event.key === 'Home') {
        event.preventDefault();
        setDishRotation(camera, 0);
      }
    });
  }

  private syncCohortPalette(status: Status): void {
    const shown = status.mouseMode === 'select' && status.highlightedCohort >= 0;
    this.cohortPalette.hidden = !shown;
    if (!shown) {
      this.lastHighlightedCohort = -1;
      return;
    }

    this.cohortPaletteTitle.textContent = `Cohort ${status.highlightedCohort + 1}`;
    if (this.lastHighlightedCohort < 0) {
      this.cohortCountInput.value = String(status.cohortCount);
    }
    this.lastHighlightedCohort = status.highlightedCohort;

    const exactSelection =
      status.selected?.cohort === status.highlightedCohort && status.selected.rule !== null;
    this.cohortSave.disabled = !exactSelection;
    this.cohortSave.title = exactSelection
      ? 'Archive this selected cohort without replacing the dish'
      : 'Click this cohort in the dish before saving it';

    const canvasRect = this.canvas.getBoundingClientRect();
    const dishRect = this.dish.getBoundingClientRect();
    let anchorY = dishRect.top + Math.min(92, dishRect.height * 0.25);
    if (status.selected !== null && status.selected.index >= 0) {
      const ndc = worldToScreenNdc(
        status.selected.pos,
        this.canvasSize(),
        [this.canvas.width, this.canvas.height],
        this.camera().pan,
        this.camera().zoom,
        this.camera().rotation,
      );
      anchorY = canvasRect.top + ((1 - ndc[1]) * canvasRect.height) / 2 - 38;
    }

    const width = Math.max(236, this.cohortPalette.offsetWidth);
    const height = Math.max(220, this.cohortPalette.offsetHeight);
    const roomRight = window.innerWidth - dishRect.right;
    const roomLeft = dishRect.left;
    let left: number;
    if (roomRight >= width + 20) left = dishRect.right + 12;
    else if (roomLeft >= width + 20) left = dishRect.left - width - 12;
    else left = window.innerWidth - width - 10;
    const launcherClearance = window.innerWidth <= 900 ? 150 : 82;
    const top = Math.max(10, Math.min(anchorY, window.innerHeight - height - launcherClearance));
    this.cohortPalette.style.left = `${Math.max(10, left)}px`;
    this.cohortPalette.style.top = `${top}px`;
  }

  private async openSelectedCapture(): Promise<void> {
    const status = this.latestStatus;
    const selected = status?.selected;
    if (
      status === null ||
      selected == null ||
      selected.rule === null ||
      selected.cohort !== status.highlightedCohort
    ) {
      return;
    }
    await this.openCapture(selected.rule, status.highlightedCohort);
  }

  private async openCapture(
    selectedRule: readonly number[] | null = null,
    selectedCohort = -1,
  ): Promise<void> {
    const live = this.bus.specimenSnapshot();
    const snapshot =
      selectedRule === null
        ? live
        : specimenSourceWithRule(
            { ...live, generation: live.generation + 1 },
            selectedRule,
          );
    this.captureButton.disabled = true;
    this.captureButton.textContent = 'Capturing…';
    const thumbnail = await captureThumbnail(this.canvas);
    this.captureButton.disabled = false;
    this.captureButton.textContent = 'Archive lineage';
    this.pendingSource = {
      ...snapshot,
      ...(thumbnail === undefined ? {} : { thumbnail }),
    };
    this.editingId = null;
    this.dialogTitle.textContent = 'Archive this lineage';
    const base = snapshot.projectName.replace(/^Specimen arena\s*[·-]?\s*/i, '').trim() || 'Specimen';
    this.nameInput.value =
      selectedCohort >= 0
        ? `${base} · cohort ${selectedCohort + 1}`
        : `${base} ${String(this.specimens.length + 1).padStart(2, '0')}`;
    this.notesInput.value = '';
    this.dialogMeta.textContent =
      selectedCohort >= 0
        ? `Generation ${snapshot.generation} · selected cohort ${selectedCohort + 1}`
        : `Generation ${snapshot.generation} · live genome snapshot`;
    this.applyDialogPreview(this.pendingSource.thumbnail);
    this.dialog.showModal();
    this.nameInput.select();
  }

  private openEdit(specimen: Specimen): void {
    this.pendingSource = null;
    this.editingId = specimen.id;
    this.dialogTitle.textContent = 'Edit specimen record';
    this.nameInput.value = specimen.name;
    this.notesInput.value = specimen.notes;
    this.dialogMeta.textContent = `${specimen.fingerprint} · captured ${shortDate(specimen.capturedAt)}`;
    this.applyDialogPreview(specimen.thumbnail, specimen.fingerprint);
    this.dialog.showModal();
    this.nameInput.select();
  }

  private applyDialogPreview(thumbnail?: string, fingerprint = ''): void {
    this.dialogPreview.style.removeProperty('background-image');
    const [a, b] = huePair(fingerprint || 'F32-4A7C9E12');
    this.dialogPreview.style.setProperty('--jar-a', String(a));
    this.dialogPreview.style.setProperty('--jar-b', String(b));
    if (thumbnail !== undefined) {
      this.dialogPreview.style.backgroundImage = `linear-gradient(180deg, transparent 35%, rgba(0,0,0,.72)), url("${thumbnail}")`;
    }
  }

  private saveDialog(): void {
    const details = { name: this.nameInput.value, notes: this.notesInput.value };
    if (this.editingId !== null) {
      const index = this.specimens.findIndex((item) => item.id === this.editingId);
      const specimen = this.specimens[index];
      if (index >= 0 && specimen !== undefined) {
        this.specimens[index] = editSpecimen(specimen, details);
        this.persistShelf();
        this.renderShelf();
        this.say('Specimen record updated.');
      }
    } else if (this.pendingSource !== null) {
      try {
        const specimen = createSpecimen(this.pendingSource, details);
        this.specimens.unshift(specimen);
        this.chosen.add(specimen.id);
        this.persistShelf();
        this.renderShelf();
        this.say(`${specimen.name} placed on the shelf.`);
      } catch (error) {
        this.say(`Could not capture specimen: ${String(error)}`);
        return;
      }
    }
    this.pendingSource = null;
    this.editingId = null;
    this.dialog.close();
  }

  private persistShelf(): void {
    if (this.specimens.length > MAX_SPECIMENS) this.specimens.length = MAX_SPECIMENS;
    if (this.storage === null) {
      this.say('Browser storage is unavailable; this shelf will last for this tab only.');
      return;
    }
    try {
      this.specimens = [...saveSpecimens(this.storage, this.specimens)];
    } catch {
      this.say('Browser storage is full; this shelf will last for this tab only.');
    }
  }

  private renderShelf(): void {
    this.shelf.replaceChildren();
    this.shelfCount.textContent = `${this.specimens.length} / ${MAX_SPECIMENS}`;
    this.shelfCount.title = `${this.specimens.length} saved specimens`;

    if (this.specimens.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lab-empty';
      const jars = document.createElement('div');
      jars.className = 'lab-empty-jars';
      jars.innerHTML = '<i></i><i></i><i></i><i></i>';
      const copy = document.createElement('p');
      copy.innerHTML = '<strong>No archived specimens.</strong><span>Capture an observed lineage to create the first record.</span>';
      empty.append(jars, copy);
      this.shelf.append(empty);
      this.syncSeedButton();
      return;
    }

    for (const specimen of this.specimens) {
      const card = document.createElement('article');
      card.className = 'specimen-jar';
      const selected = this.chosen.has(specimen.id);
      card.classList.toggle('is-selected', selected);
      const [a, b] = huePair(specimen.fingerprint);
      card.style.setProperty('--jar-a', String(a));
      card.style.setProperty('--jar-b', String(b));

      const select = button('', 'specimen-jar-select');
      select.setAttribute('aria-pressed', String(selected));
      select.setAttribute('aria-label', `${selected ? 'Remove' : 'Add'} ${specimen.name} ${selected ? 'from' : 'to'} the next arena`);
      const image = document.createElement('span');
      image.className = 'specimen-jar-image';
      if (specimen.thumbnail !== undefined) {
        image.style.backgroundImage =
          `linear-gradient(180deg, transparent 40%, rgba(0,0,0,.78)), url("${specimen.thumbnail}")`;
      }
      const check = document.createElement('i');
      check.className = 'specimen-jar-check';
      check.textContent = selected ? '✓' : '+';
      const generation = document.createElement('small');
      generation.textContent = `GEN ${String(specimen.generation).padStart(2, '0')}`;
      image.append(check, generation);
      const copy = document.createElement('span');
      copy.className = 'specimen-jar-copy';
      const name = document.createElement('strong');
      name.textContent = specimen.name;
      const notes = document.createElement('span');
      notes.textContent = specimen.notes || 'No field notes yet.';
      const fingerprint = document.createElement('code');
      fingerprint.textContent = specimen.fingerprint;
      copy.append(name, notes, fingerprint);
      select.append(image, copy);
      select.addEventListener('click', () => this.toggleChosen(specimen));

      const actions = document.createElement('div');
      actions.className = 'specimen-jar-actions';
      const date = document.createElement('time');
      date.dateTime = specimen.capturedAt;
      date.textContent = shortDate(specimen.capturedAt);
      const edit = button('Edit', 'specimen-edit');
      edit.addEventListener('click', () => this.openEdit(specimen));
      const remove = button('×', 'specimen-remove');
      remove.title = `Remove ${specimen.name}`;
      remove.setAttribute('aria-label', remove.title);
      remove.addEventListener('click', () => this.removeSpecimen(specimen));
      actions.append(date, edit, remove);
      card.append(select, actions);
      this.shelf.append(card);
    }
    this.syncSeedButton();
  }

  private toggleChosen(specimen: Specimen): void {
    if (this.chosen.has(specimen.id)) {
      this.chosen.delete(specimen.id);
    } else if (this.chosen.size >= MAX_ARENA_SPECIMENS) {
      this.say(`An arena can hold at most ${MAX_ARENA_SPECIMENS} specimen lineages.`);
      return;
    } else {
      this.chosen.add(specimen.id);
    }
    this.renderShelf();
  }

  private removeSpecimen(specimen: Specimen): void {
    if (!window.confirm(`Remove “${specimen.name}” from the specimen shelf?`)) return;
    this.specimens = this.specimens.filter((item) => item.id !== specimen.id);
    this.chosen.delete(specimen.id);
    this.persistShelf();
    this.renderShelf();
    this.say(`${specimen.name} removed from the shelf.`);
  }

  private seedArena(): void {
    const selected = this.specimens.filter((item) => this.chosen.has(item.id));
    if (selected.length === 0) return;
    try {
      const saved = buildSpecimenArena(selected, Number(this.variation.value));
      const name =
        selected.length === 1
          ? `${selected[0]!.name} offspring`
          : `Specimen arena · ${selected.length} lineages`;
      this.bus.dispatch({ kind: 'seedSpecimenArena', saved, name });
      this.say(`New dish seeded from ${selected.length} ${selected.length === 1 ? 'jar' : 'jars'}.`);
    } catch (error) {
      this.say(String(error));
    }
  }

  private syncVariation(): void {
    this.variationReadout.value = Number(this.variation.value).toFixed(3);
    this.variationReadout.textContent = this.variationReadout.value;
  }

  private syncSeedButton(): void {
    const count = this.chosen.size;
    this.seedButton.disabled = count === 0;
    this.seedButton.textContent = count === 0 ? 'Inoculate' : `Inoculate · ${count}`;
  }

  private say(message: string): void {
    window.clearTimeout(this.toastTimer);
    this.toast.textContent = message;
    this.toast.classList.add('is-visible');
    this.toastTimer = window.setTimeout(() => {
      this.toast.classList.remove('is-visible');
    }, 3_800);
  }
}
