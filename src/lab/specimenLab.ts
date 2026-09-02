import type { CommandBus, Status } from '../orchestrator/commands.ts';
import type { CameraState } from '../camera/cameraState.ts';
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
  type Specimen,
  type SpecimenSource,
} from './specimens.ts';
import './specimenLab.css';

export interface SpecimenLabOptions {
  readonly bus: CommandBus;
  readonly canvas: HTMLCanvasElement;
  readonly camera: () => CameraState;
  readonly canvasSize: () => readonly [number, number];
  readonly mobile?: boolean;
}

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

/** The naturalist layer around the existing select-and-mutate simulation. */
export class SpecimenLab {
  private readonly bus: CommandBus;
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: () => CameraState;
  private readonly canvasSize: () => readonly [number, number];
  private readonly dish: HTMLElement;
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

    this.dish = document.createElement('div');
    this.dish.id = 'fluoddity-petri-dish';
    this.dish.setAttribute('aria-hidden', 'true');
    this.dish.innerHTML =
      '<i class="dish-bearing"></i>' +
      '<span class="dish-id">CULTURE VESSEL / 01</span>' +
      '<span class="dish-state"><i></i>CONTAINMENT ACTIVE</span>' +
      '<span class="dish-scale">Ø 0.86 · SEALED FIELD</span>';
    document.body.append(this.dish);

    const startsCollapsed = opts.mobile === true;
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
        '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
          '<path d="M7 2.5c0 5.2 10 5.2 10 9.5S7 16.3 7 21.5M17 2.5c0 5.2-10 5.2-10 9.5s10 4.3 10 9.5"></path>' +
          '<path d="M8.1 5.5h7.8M7.3 9h9.4M7.3 15h9.4M8.1 18.5h7.8"></path>' +
        '</svg>' +
      '</button>' +
      '<span><small>SPECIMEN ARCHIVE / NODE 02</small><strong>Lineage registry</strong></span>';
    this.shelfCount = document.createElement('span');
    this.shelfCount.className = 'lab-count';
    const collapse = heading.querySelector<HTMLButtonElement>('.lab-toggle')!;
    collapse.title = startsCollapsed ? 'Open specimen shelf' : 'Collapse specimen shelf';
    collapse.setAttribute('aria-expanded', String(!startsCollapsed));
    collapse.addEventListener('click', () => {
      const collapsed = this.root.classList.toggle('is-collapsed');
      collapse.title = collapsed ? 'Open specimen shelf' : 'Collapse specimen shelf';
      collapse.setAttribute('aria-label', collapse.title);
      collapse.setAttribute('aria-expanded', String(!collapsed));
    });
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
    this.captureButton = button('Capture specimen', 'lab-capture');
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
    document.body.append(this.root);

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

  refresh(status: Status): void {
    this.syncDishView();
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
    this.dish.style.left = `${rect.left + localX}px`;
    this.dish.style.top = `${rect.top + localY}px`;
    this.dish.style.width = `${radius * 2}px`;
    this.dish.style.setProperty('--lab-dish-rotation', `${-camera.rotation}rad`);
  }

  private async openCapture(): Promise<void> {
    const snapshot = this.bus.specimenSnapshot();
    this.captureButton.disabled = true;
    this.captureButton.textContent = 'Capturing…';
    const thumbnail = await captureThumbnail(this.canvas);
    this.captureButton.disabled = false;
    this.captureButton.textContent = 'Capture specimen';
    this.pendingSource = {
      ...snapshot,
      ...(thumbnail === undefined ? {} : { thumbnail }),
    };
    this.editingId = null;
    this.dialogTitle.textContent = 'Archive this lineage';
    const base = snapshot.projectName.replace(/^Specimen arena\s*[·-]?\s*/i, '').trim() || 'Specimen';
    this.nameInput.value = `${base} ${String(this.specimens.length + 1).padStart(2, '0')}`;
    this.notesInput.value = '';
    this.dialogMeta.textContent = `Generation ${snapshot.generation} · live genome snapshot`;
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
