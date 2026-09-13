import { DecimalPipe } from '@angular/common';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, signal,
  viewChild,
} from '@angular/core';
import { FIELD_THEME, INDOOR_LOOK, type SplatGround } from '../board-assets';
import { sceneForEncounter } from '../board-scene';
import { type GroundField, groundField } from '../ground-field';
import { ROAD_NAME, roadMap } from '../road-level';
import { clockLabel } from '../sun-position';
import { assetUrl } from './assets';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/loaders/glTF/2.0';
import { cardGeometry, type FoliageSheet, loadFoliage } from './foliage-cards';
import {
  FIELDSTONE, GROUND_FLORA, STANDING, plantScans, scatterFlora, scatterStone,
  shadowProxy,
} from './standing';

function read(key: string, fallback: boolean): boolean {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? fallback : saved === 'true';
  } catch {
    return fallback;
  }
}

function write(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {

  }
}

function dayLabel(day: number): string {
  const at = new Date(Date.UTC(2026, 0, 1));
  at.setUTCDate(day);
  const month = at.toLocaleString('en', { month: 'short', timeZone: 'UTC' });
  const date = at.getUTCDate();
  const part = date <= 10 ? 'early' : date <= 20 ? 'mid' : 'late';
  return `${part} ${month}`;
}

type Part = 'meadow' | 'flora' | 'trees' | 'stones' | 'terrain' | 'shadows'
  | 'taa' | 'relief' | 'sky' | 'dome' | 'grade' | 'bloom';
import { type Meadow, sowMeadow } from './meadow';
import { type Asset, PlantPreview } from './plant-preview';
import { type Plant, MEADOW, plantTriangles } from './species';
import { type Slice, splitFrame } from './split-frame';
import { Stage } from './stage';
import { type FrameCost, Stats } from './stats';
import { type Terrain, buildTerrain } from './terrain';

@Component({
  selector: 'ooze-bab-board',
  standalone: true,
  imports: [DecimalPipe, PlantPreview],
  changeDetection: ChangeDetectionStrategy.OnPush,

  host: { class: 'dark ooze-board block w-full' },
  styles: [`
    :host {
      display: block;
      height: calc(100vh - var(--ooze-shell-header, 3.5rem));
      height: calc(100dvh - var(--ooze-shell-header, 3.5rem));
      background: var(--color-bg);
    }
  `],
  template: `
    <div class="relative h-full w-full overflow-hidden bg-bg">
      <canvas #canvas class="absolute inset-0 h-full w-full outline-none"
        style="touch-action: none; overscroll-behavior: contain"></canvas>

      <div class="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-2">
        <div class="pointer-events-auto flex max-w-[min(34rem,calc(100%-6rem))] flex-col gap-2
                    rounded-lg border border-rule bg-bg/80 p-2 shadow-xl backdrop-blur">
          <div class="flex items-center gap-2">
            <button type="button" (click)="toggleTools()"
              class="grid size-6 shrink-0 place-items-center rounded border border-rule text-fg-muted transition-colors hover:border-accent hover:text-accent"
              [attr.aria-expanded]="tools()"
              [attr.aria-label]="tools() ? 'Collapse tools' : 'Expand tools'">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" class="size-3.5 transition-transform"
                   [class.rotate-90]="tools()">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
            <span class="truncate text-xs font-semibold text-fg">{{ name }}</span>
            @if (cost(); as c) {
              <span class="ml-auto shrink-0 font-mono text-[0.65rem] tabular-nums text-fg-muted">
                {{ c.fps }} fps · {{ c.cpuMs }} ms
              </span>
            }
          </div>

          @if (tools()) {
            <div class="flex flex-col gap-2 border-t border-rule pt-2">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem] text-fg-muted">
                <label class="flex items-center gap-1.5">
                  Time
                  <input
                    type="range" min="4" max="21" step="0.25"
                    [value]="hour()" (input)="setHour($any($event.target).valueAsNumber)"
                    class="w-28" />
                  <span class="w-14 tabular-nums">{{ clock() }}</span>
                </label>
                <label class="flex items-center gap-1.5">
                  Grass
                  <input
                    type="range" min="0" max="100" step="1"
                    [value]="density()" (input)="setDensity($any($event.target).valueAsNumber)"
                    class="w-24" />
                  <span class="w-9 tabular-nums">{{ density() }}%</span>
                </label>
                <label class="flex items-center gap-1.5"
                  title="How far each leaf's shading normal is pulled onto the ground's own. At 100% the grass is lit almost entirely by the terrain, which is why per-blade normal work is invisible.">
                  Leaf normal
                  <input
                    type="range" min="0" max="100" step="5"
                    [value]="leafNormal()" (input)="setLeafNormal($any($event.target).valueAsNumber)"
                    class="w-20" />
                  <span class="w-9 tabular-nums">{{ leafNormal() }}%</span>
                </label>
                <label class="flex items-center gap-1.5"
                  title="Scales every plant's wind strength. The board ships at 100%, which is 0.62 of the plugin's own default.">
                  Wind
                  <input
                    type="range" min="0" max="300" step="10"
                    [value]="wind()" (input)="setWind($any($event.target).valueAsNumber)"
                    class="w-20" />
                  <span class="w-9 tabular-nums">{{ wind() }}%</span>
                </label>
                <label class="flex items-center gap-1.5">
                  Season
                  <input type="range" min="1" max="365" step="1" [value]="day()"
                    (input)="setDay(+$any($event.target).value)" class="w-24" />
                  <span class="w-16 tabular-nums">{{ dayLabel() }}</span>
                </label>
              </div>

              <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[0.65rem] text-fg-subtle">
                <span class="uppercase tracking-widest">show</span>
                @for (part of parts; track part.key) {
                  <label class="flex items-center gap-1" [title]="part.note">
                    <input type="checkbox" [checked]="on()[part.key] !== false"
                      (change)="toggle(part.key, $any($event.target).checked)" />
                    {{ part.label }}
                  </label>
                }
              </div>

              <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[0.65rem] text-fg-subtle">
                <span class="uppercase tracking-widest">probe</span>
                <label class="flex items-center gap-1">
                  <input type="checkbox" [checked]="flat()"
                    (change)="setFlat($any($event.target).checked)" />
                  flat light
                </label>
                <button type="button" (click)="split()" [disabled]="splitting()"
                  class="rounded border border-rule px-1.5 py-0.5 hover:border-accent disabled:opacity-50">
                  {{ splitting() ? 'measuring…' : 'split frame' }}
                </button>
                <button type="button" (click)="inspect()"
                  class="rounded border border-rule px-1.5 py-0.5 hover:border-accent">
                  inspector
                </button>
                @for (slice of slices(); track slice.name) {
                  <span class="tabular-nums">
                    {{ slice.name }}
                    <span class="text-fg">{{ slice.ms }} ms</span>
                  </span>
                }
              </div>

              @if (cost(); as c) {
                <dl class="flex flex-wrap gap-x-3 gap-y-0.5 border-t border-rule pt-2 font-mono text-[0.65rem] text-fg-subtle">
                  <div><dt class="inline">wall</dt> <dd class="inline tabular-nums text-fg">{{ c.wallMs }} ms</dd></div>
                  <div><dt class="inline">pixels</dt> <dd class="inline tabular-nums text-fg">{{ c.pixels }} · {{ c.megapixels }} MP</dd></div>
                  <div><dt class="inline">cull</dt> <dd class="inline tabular-nums text-fg">{{ c.cullMs }} ms</dd></div>
                  <div><dt class="inline">draws</dt> <dd class="inline tabular-nums text-fg">{{ c.drawCalls }}</dd></div>
                  <div><dt class="inline">meshes</dt> <dd class="inline tabular-nums text-fg">{{ c.activeMeshes }}</dd></div>
                  <div><dt class="inline">tris</dt> <dd class="inline tabular-nums text-fg">{{ c.triangles | number }}</dd></div>
                  <div><dt class="inline">shaders</dt> <dd class="inline tabular-nums text-fg">{{ c.shaderMs }} ms</dd></div>
                </dl>
                <dl class="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[0.65rem] text-fg-subtle">
                  @for (pass of c.passes; track pass.name) {
                    <div><dt class="inline">{{ pass.name }}</dt> <dd class="inline tabular-nums text-fg">{{ pass.ms }} ms</dd></div>
                  }
                </dl>
              }

              <p class="font-mono text-[0.6rem] text-fg-subtle">{{ status() }}</p>
            </div>
          }
        </div>

        <div class="pointer-events-auto flex shrink-0 flex-col items-end gap-1">
          <div class="flex items-center gap-1 rounded-lg border border-rule bg-bg/80 p-1 shadow-xl backdrop-blur">
            <button type="button" (click)="setPan(false)"
              class="rounded px-2 py-1 font-mono text-[0.65rem] transition-colors"
              [class.bg-accent]="!pan()" [class.text-accent-fg]="!pan()"
              [class.text-fg-muted]="pan()"
              title="Left drag orbits. Right, middle or shift-drag pans.">orbit</button>
            <button type="button" (click)="setPan(true)"
              class="rounded px-2 py-1 font-mono text-[0.65rem] transition-colors"
              [class.bg-accent]="pan()" [class.text-accent-fg]="pan()"
              [class.text-fg-muted]="!pan()"
              title="Left drag pans. Right, middle and shift-drag pan too.">pan</button>
            <button type="button" (click)="recentre()"
              class="rounded border border-rule px-2 py-1 font-mono text-[0.65rem] text-fg-muted transition-colors hover:border-accent hover:text-accent"
              title="Frame the whole board again.">fit</button>
          </div>
        </div>
      </div>

      @if (!flora()) {
        <button type="button" (click)="flora.set(true)"
          class="group absolute right-2 top-1/2 z-20 flex w-9 -translate-y-1/2 flex-col items-center gap-3 rounded-l-lg border-y border-l border-rule-strong bg-bg/80 py-3 text-fg-muted shadow-lg backdrop-blur transition-colors hover:text-fg"
          aria-label="Open the asset panel">
          <span class="grid size-5 shrink-0 place-items-center rounded border border-rule-strong text-fg-muted transition-colors group-hover:border-accent group-hover:text-accent">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" class="size-3">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <span class="text-[0.6rem] font-semibold uppercase tracking-[0.2em]"
                style="writing-mode: vertical-rl">Assets</span>
        </button>
      }

      @if (flora()) {
        <aside class="absolute inset-y-0 right-0 z-30 flex w-[27rem] max-w-[90vw] flex-col border-l border-rule bg-bg/95 shadow-xl backdrop-blur">
          <div class="flex h-11 shrink-0 items-center justify-between border-b border-rule px-3">
            <span class="text-sm font-semibold text-fg">Assets</span>
            <button type="button" (click)="flora.set(false)"
              class="grid size-7 place-items-center rounded text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
              aria-label="Collapse the asset panel">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" class="size-4">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>

          <div class="h-72 shrink-0 border-b border-rule p-2">
            <ooze-plant-preview [asset]="chosen()" [angle]="angle()" [spin]="spin()" />
          </div>
          <div class="flex shrink-0 flex-wrap items-center gap-1 border-b border-rule px-2 py-1.5 font-mono text-[0.65rem]">
            @for (where of angles; track where.key) {
              <button type="button" (click)="angle.set(where.key)" [title]="where.note"
                class="rounded px-2 py-1 transition-colors"
                [class.bg-accent]="angle() === where.key"
                [class.text-accent-fg]="angle() === where.key"
                [class.text-fg-muted]="angle() !== where.key">{{ where.label }}</button>
            }
            <button type="button" (click)="spin.set(!spin())"
              class="ml-auto rounded border border-rule px-2 py-1 transition-colors"
              [class.border-accent]="spin()" [class.text-accent]="spin()"
              [class.text-fg-muted]="!spin()"
              title="Turntable. Off holds the angle so a silhouette can be read.">spin</button>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto p-3">
            @if (chosen(); as pick) {
              @if (pick.kind === 'plant') {
                <p class="font-mono text-[0.6rem] text-fg-subtle">
                  {{ pick.plant.tall / 2 | number:'1.1-1' }} ft tall ·
                  {{ triangles(pick.plant) }} tris ·
                  {{ share(pick.plant) }}% of the grass ·
                  {{ drawn(pick.plant) | number }} drawn
                </p>
                <table class="mt-2 w-full font-mono text-[0.6rem] text-fg-subtle">
                  <thead class="text-fg-whisper">
                    <tr class="text-left">
                      <th class="font-normal">card</th><th class="font-normal">n</th>
                      <th class="font-normal">tall</th><th class="font-normal">lean</th>
                      <th class="font-normal">rows</th><th class="font-normal">how</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (card of pick.plant.cards; track $index) {
                      <tr>
                        <td class="text-fg">{{ card.group }}</td>
                        <td class="tabular-nums">{{ card.count }}</td>
                        <td class="tabular-nums">{{ card.tall }}</td>
                        <td class="tabular-nums">{{ card.flat ? '90' : (card.lean * 57.3 | number:'1.0-0') }}</td>
                        <td class="tabular-nums" [class.text-danger]="card.rows < 3">{{ card.rows }}</td>
                        <td>{{ card.flat ? 'flat ' : '' }}{{ card.trimStalk ? 'trim ' : '' }}{{ card.centred ? 'centred' : '' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
                <p class="mt-2 text-xs leading-relaxed text-fg-muted">{{ pick.plant.note }}</p>
              } @else {
                <p class="font-mono text-[0.6rem] text-fg-subtle">
                  {{ pick.name }} · part {{ pick.part }} · scanned glTF
                </p>
                <p class="mt-2 text-xs leading-relaxed text-fg-muted">
                  Photogrammetry from Poly Haven, CC0. Used near the size it was
                  captured at — leaf density falls with the cube of the scale,
                  so a shrub blown up to tree height comes out see-through.
                </p>
              }
            }

            <p class="mt-4 font-mono text-[0.6rem] uppercase tracking-widest text-fg-whisper">grass</p>
            <ul class="mt-1 flex flex-col gap-1">
              @for (plant of species; track plant.id) {
                <li>
                  <button type="button" (click)="pickPlant(plant)"
                    class="w-full rounded border px-2 py-1.5 text-left text-xs transition-colors"
                    [class.border-accent]="isPlant(plant)"
                    [class.text-fg]="isPlant(plant)"
                    [class.border-rule]="!isPlant(plant)"
                    [class.text-fg-muted]="!isPlant(plant)">
                    <span class="font-medium">{{ plant.name }}</span>
                    <span class="ml-1 font-mono text-[0.6rem] text-fg-subtle">
                      {{ share(plant) }}%
                    </span>
                  </button>
                </li>
              }
            </ul>

            <p class="mt-4 font-mono text-[0.6rem] uppercase tracking-widest text-fg-whisper">standing</p>
            <ul class="mt-1 flex flex-col gap-1">
              @for (kind of standing; track $index) {
                <li>
                  <button type="button" (click)="pickScan(kind.name, kind.plant ?? 0)"
                    class="w-full rounded border px-2 py-1.5 text-left text-xs transition-colors"
                    [class.border-accent]="isScan(kind.name, kind.plant ?? 0)"
                    [class.text-fg]="isScan(kind.name, kind.plant ?? 0)"
                    [class.border-rule]="!isScan(kind.name, kind.plant ?? 0)"
                    [class.text-fg-muted]="!isScan(kind.name, kind.plant ?? 0)">
                    <span class="font-medium">{{ kind.label }}</span>
                    <span class="ml-1 font-mono text-[0.6rem] text-fg-subtle">
                      &times;{{ kind.count }} · {{ kind.tall / 2 | number:'1.0-1' }} ft
                    </span>
                  </button>
                </li>
              }
            </ul>

            <p class="mt-4 font-mono text-[0.6rem] uppercase tracking-widest text-fg-whisper">
              flowers &amp; broadleaf
            </p>
            <ul class="mt-1 flex flex-col gap-1">
              @for (kind of floraScans; track $index) {
                <li>
                  <button type="button" (click)="pickScan(kind.name, kind.part)"
                    class="w-full rounded border px-2 py-1.5 text-left text-xs transition-colors"
                    [class.border-accent]="isScan(kind.name, kind.part)"
                    [class.text-fg]="isScan(kind.name, kind.part)"
                    [class.border-rule]="!isScan(kind.name, kind.part)"
                    [class.text-fg-muted]="!isScan(kind.name, kind.part)">
                    <span class="font-medium">{{ kind.label }}</span>
                    <span class="ml-1 font-mono text-[0.6rem] text-fg-subtle">
                      &times;{{ kind.count }} · {{ kind.tall / 2 | number:'1.0-1' }} ft
                    </span>
                  </button>
                </li>
              }
            </ul>

            <p class="mt-4 font-mono text-[0.6rem] uppercase tracking-widest text-fg-whisper">fieldstone</p>
            <ul class="mt-1 flex flex-col gap-1">
              @for (kind of fieldstone; track $index) {
                <li>
                  <button type="button" (click)="pickScan(kind.name, kind.rock ?? 0)"
                    class="w-full rounded border px-2 py-1.5 text-left text-xs transition-colors"
                    [class.border-accent]="isScan(kind.name, kind.rock ?? 0)"
                    [class.text-fg]="isScan(kind.name, kind.rock ?? 0)"
                    [class.border-rule]="!isScan(kind.name, kind.rock ?? 0)"
                    [class.text-fg-muted]="!isScan(kind.name, kind.rock ?? 0)">
                    <span class="font-medium">{{ kind.label }}</span>
                    <span class="ml-1 font-mono text-[0.6rem] text-fg-subtle">
                      {{ kind.tall / 2 | number:'1.0-1' }} ft {{ kind.open ? 'grass' : 'verge' }}
                    </span>
                  </button>
                </li>
              }
            </ul>
          </div>
        </aside>
      }

      @if (fault(); as message) {
        <p class="absolute inset-x-0 top-1/2 z-20 px-6 text-center text-sm text-fg">
          {{ message }}
        </p>
      }
    </div>
  `,
})
export class BabBoard implements AfterViewInit, OnDestroy {

  protected readonly name = ROAD_NAME;
  protected readonly hour = signal(13);
  protected readonly clock = signal(clockLabel(13));
  protected readonly status = signal('starting…');
  protected readonly cost = signal<FrameCost | null>(null);
  protected readonly density = signal(100);

  protected readonly flora = signal(false);

  protected readonly tools = signal(read('ooze.board.tools', true));

  protected readonly pan = signal(false);
  protected readonly angle = signal<'top' | 'three' | 'side' | 'low'>('three');
  protected readonly spin = signal(true);
  protected readonly angles: readonly {
    key: 'top' | 'three' | 'side' | 'low'; label: string; note: string;
  }[] = [
    { key: 'top', label: 'top', note: 'Straight down — the board\'s own camera.' },
    { key: 'three', label: 'three-quarter', note: 'The usual playing angle.' },
    { key: 'low', label: 'low', note: 'The shallow angle a flat card disappears at.' },
    { key: 'side', label: 'side', note: 'Level with the plant, for its height and its stem.' },
  ];
  protected readonly species = MEADOW;
  protected readonly chosen = signal<Asset>({ kind: 'plant', plant: MEADOW[0] });
  protected readonly standing = STANDING;
  protected readonly fieldstone = FIELDSTONE;
  protected readonly floraScans = GROUND_FLORA;

  protected pickPlant(plant: Plant): void {
    this.chosen.set({ kind: 'plant', plant });
  }

  protected pickScan(name: string, part: number): void {
    this.chosen.set({ kind: 'scan', name, part });
  }

  protected isPlant(plant: Plant): boolean {
    const pick = this.chosen();
    return pick.kind === 'plant' && pick.plant.id === plant.id;
  }

  protected isScan(name: string, part: number): boolean {
    const pick = this.chosen();
    return pick.kind === 'scan' && pick.name === name && pick.part === part;
  }
  protected readonly fault = signal<string | null>(null);

  protected readonly flat = signal(false);
  protected readonly splitting = signal(false);
  protected readonly slices = signal<readonly Slice[]>([]);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private stage: Stage | null = null;

  private extent: { x: number; y: number } | null = null;
  private stats: Stats | null = null;
  private meadow: Meadow | null = null;
  private field: GroundField | null = null;
  private sheet: FoliageSheet | null = null;
  private stones: Mesh[] = [];
  private groundFlora: Mesh[] = [];

  protected readonly parts: readonly { key: Part; label: string; note: string }[] = [
    { key: 'meadow', label: 'grass', note: 'The grass, clover, plantain and daisies.' },
    { key: 'flora', label: 'ground flora', note: 'Scanned plants standing in the grass.' },
    { key: 'trees', label: 'trees', note: 'Scanned trees and scrub.' },
    { key: 'stones', label: 'stone', note: 'Scanned fieldstone.' },
    { key: 'terrain', label: 'terrain', note: 'The forty ground chunks. Off, the grass stands in the sky.' },
    { key: 'shadows', label: 'shadows', note: 'The sun\'s cascaded shadow map.' },
    { key: 'taa', label: 'temporal aa', note: 'The temporal resolve. Off is sharper and crawls.' },
    { key: 'relief', label: 'ground relief', note: 'The terrain normal and roughness maps.' },
    { key: 'sky', label: 'sky light', note: 'Image-based light from the sky probe.' },
    { key: 'dome', label: 'sky dome', note: 'The sky itself, drawn. Off leaves the clear colour behind the board.' },
    { key: 'grade', label: 'grade', note: 'Tone mapping, contrast and exposure.' },
    { key: 'bloom', label: 'bloom', note: 'Light spilling around bright edges. Off: nothing on a midday meadow is bright enough to bloom — measured, everything sits under 0.4 luminance. It is here for torches and fire.' },
  ];

  protected readonly on = signal<Partial<Record<Part, boolean>>>({ bloom: false });

  protected readonly leafNormal = signal(50);
  protected readonly wind = signal(300);
  private readonly litAsBuilt = new Map<string, number>();
  private readonly gustAsBuilt = new Map<string, number>();
  private readonly proxies: Mesh[] = [];

  protected readonly day = signal(196);
  protected readonly dayLabel = signal('mid Jul');

  protected setDay(day: number): void {
    this.day.set(day);
    this.dayLabel.set(dayLabel(day));
    this.stage?.setDay(day);

    const year = (day - 1) / 365;
    const green = Math.max(0.12, Math.min(1,
      0.5 - 0.52 * Math.cos((year - 0.04) * Math.PI * 2)));
    const bloom = Math.max(0, Math.min(1,
      1 - Math.abs(day - 172) / 52));
    this.meadow?.setSeason(green, bloom);
    this.stage?.setSeasonTint(green);
  }

  protected toggle(part: Part, want: boolean): void {
    this.on.update(was => ({ ...was, [part]: want }));
    const stage = this.stage;
    if (!stage) {
      return;
    }
    switch (part) {
      case 'meadow':
        this.meadow?.sown.forEach(sown => sown.mesh.setEnabled(want));
        break;
      case 'flora':
        this.groundFlora.forEach(mesh => mesh.setEnabled(want));
        break;
      case 'terrain':
        this.terrain?.chunks.forEach(chunk => chunk.setEnabled(want));
        break;
      case 'trees':
        this.stones.filter(mesh => mesh.name.startsWith('scan-'))
          .forEach(mesh => mesh.setEnabled(want));
        break;
      case 'stones':
        this.stones.filter(mesh => mesh.name.startsWith('stone-'))
          .forEach(mesh => mesh.setEnabled(want));
        break;
      case 'shadows':
        stage.setShadows(want);
        break;
      case 'taa':
        stage.setResolve(want);
        break;
      case 'relief':
        stage.setRelief(want);
        break;
      case 'sky':
        stage.setSkyLight(want);
        break;
      case 'dome':
        stage.setSkyDome(want);
        break;
      case 'grade':
        stage.setGrade(want);
        break;
      case 'bloom':
        stage.setBloom(want);
        break;
    }
  }
  private ticker = 0;
  private gone = false;
  private terrain: Terrain | null = null;
  private observer: ResizeObserver | null = null;

  ngAfterViewInit(): void {
    void this.open(this.canvas().nativeElement);
  }

  private async open(canvas: HTMLCanvasElement): Promise<void> {
    if (this.stage) {
      return;
    }
    try {
      const theme = FIELD_THEME;
      const ground = theme.ground as SplatGround;
      const stage = await Stage.open(
        canvas, theme.look ?? INDOOR_LOOK, theme.environment?.url,
      );
      if (this.gone) {

        stage.dispose();
        return;
      }
      this.stage = stage;

      const scene = sceneForEncounter({
        id: 'road',
        name: ROAD_NAME,
        map: { id: 'road-map', ...roadMap() },
        combatants: [],
      });
      const field = groundField(scene);
      this.terrain = buildTerrain(ground, field, stage.scene);
      this.terrain.chunks.forEach(chunk => stage.shadows.addShadowCaster(chunk));
      this.terrain.grassProxy.forEach(chunk => stage.shadows.addShadowCaster(chunk));

      const sheet = await loadFoliage(stage.scene);
      this.sheet = sheet;
      this.field = field;
      this.meadow = this.grow();
      this.setLeafNormal(this.leafNormal());
      this.setWind(this.wind());

      this.stones = [
        ...await plantScans(field, stage.scene),
        ...await scatterStone(field, stage.scene),
      ];
      this.stones.forEach(stone => {
        const proxy = shadowProxy(stone, stage.scene);
        if (proxy) {
          this.proxies.push(proxy);
          stage.shadows.addShadowCaster(proxy);
        } else {
          stage.shadows.addShadowCaster(stone);
        }
      });

      this.groundFlora = await scatterFlora(field, stage.scene);

      stage.scene.onBeforeRenderObservable.add(() => {
        this.meadow?.step(performance.now() / 1000);
      });

      this.extent = { x: field.extentXHalfFeet, y: field.extentYHalfFeet };
      stage.frame(
        field.extentXHalfFeet / 2, field.extentYHalfFeet / 2, 0,
        Math.max(field.extentXHalfFeet, field.extentYHalfFeet),
      );

      const board = this;
      (globalThis as unknown as Record<string, unknown>)['bab'] = {
        stage, terrain: this.terrain, field,
        get meadow(): Meadow | null { return board.meadow; },
        cost: (): FrameCost | null => this.stats?.read() ?? null,
        sow: sowMeadow,
        species: MEADOW,
        sheet,
        shot: async (width = 900): Promise<string> => {
          const was = stage.jittering();
          const gusts = (board.meadow?.sown ?? []).map(sown => sown.wind.strength);
          stage.jitter(false);
          (board.meadow?.sown ?? []).forEach(sown => { sown.wind.strength = 0; });
          try {
            await new Promise<void>(done => {
              let left = 4;
              const tick = (): void => {
                left -= 1;
                if (left > 0) { requestAnimationFrame(tick); } else { done(); }
              };
              requestAnimationFrame(tick);
            });
            const live = stage.scene.getEngine().getRenderingCanvas()!;
            const flat = document.createElement('canvas');
            flat.width = width;
            flat.height = Math.round((live.height / live.width) * width);
            flat.getContext('2d')!.drawImage(live, 0, 0, flat.width, flat.height);
            return flat.toDataURL('image/png');
          } finally {
            stage.jitter(was);
            (board.meadow?.sown ?? []).forEach((sown, at) => {
              sown.wind.strength = gusts[at];
            });
          }
        },
        split: async (): Promise<readonly Slice[]> => {
          await this.split();
          return this.slices();
        },
      };
      stage.start();
      this.stats = new Stats(stage.scene, this.meadow?.compute ?? []);

      this.ticker = window.setInterval(() => this.cost.set(this.stats?.read() ?? null), 1000);
      this.status.set(this.lattice());

      this.observer = new ResizeObserver(() => stage.resize());
      this.observer.observe(canvas);
    } catch (error) {

      console.error('[board]', error);
      this.fault.set(String((error as { message?: string })?.message ?? error));
    }
  }

  protected async inspect(): Promise<void> {
    const scene = this.stage?.scene;
    if (!scene) {
      return;
    }
    await import('@babylonjs/inspector');
    if (scene.debugLayer.isVisible()) {
      scene.debugLayer.hide();
    } else {
      await scene.debugLayer.show({ embedMode: true, overlay: true });
    }
  }

  protected setFlat(on: boolean): void {
    this.flat.set(on);
    const stage = this.stage;
    if (!stage) {
      return;
    }
    if (on) {
      stage.sun.setEnabled(false);
      stage.bounce.setEnabled(false);
      stage.ambient.diffuse = new Color3(1, 1, 1);
      stage.ambient.groundColor = new Color3(1, 1, 1);
      stage.ambient.intensity = 1;
    } else {
      stage.sun.setEnabled(true);
      stage.bounce.setEnabled(true);

      stage.setClock(this.hour());
    }
  }

  protected async split(): Promise<void> {
    if (!this.stage || this.splitting()) {
      return;
    }
    this.splitting.set(true);
    this.slices.set([]);
    try {
      this.slices.set(await splitFrame(
        this.parts
          .filter(part => this.on()[part.key] !== false)
          .map(part => ({
            name: part.label,
            set: (want: boolean): void => this.toggle(part.key, want),
          })),
      ));
    } finally {
      this.splitting.set(false);
    }
  }

  protected triangles(plant: Plant): number {
    return plantTriangles(plant);
  }

  protected share(plant: Plant): number {
    const total = MEADOW.reduce((sum, p) => sum + p.perArea, 0);
    return Math.round((plant.perArea / total) * 100);
  }

  protected drawn(plant: Plant): number {
    return this.meadow?.sown.find(s => s.plant.id === plant.id)?.count ?? 0;
  }

  private grow(): Meadow {
    const meadow = sowMeadow(
      this.field!, this.stage!.scene, this.sheet!, undefined, cardGeometry, true,
    );
    if (this.density() !== 100) {
      meadow.setDensity(this.density() / 100);
    }
    return meadow;
  }

  private lattice(): string {
    const meadow = this.meadow;
    if (!meadow) {
      return '';
    }
    const triangles = meadow.sown.reduce(
      (sum, sown) => sum + sown.mesh.getTotalIndices() / 3, 0,
    );
    return `${this.terrain?.chunks.length ?? 0} chunks · lattice `
      + `${meadow.lattice.cells.toLocaleString()} cells at `
      + `${meadow.lattice.pitch.toFixed(2)} half-feet · grass `
      + `${Math.round(triangles).toLocaleString()} tris a plant set`
      + (meadow.lattice.fit < 1
        ? ` · grass capped to ${Math.round(meadow.lattice.fit * 100)}%` : '');
  }

  protected setWind(percent: number): void {
    this.wind.set(percent);
    for (const sown of this.meadow?.sown ?? []) {
      const built = this.gustAsBuilt.get(sown.plant.id) ?? sown.wind.strength;
      this.gustAsBuilt.set(sown.plant.id, built);
      sown.wind.strength = built * (percent / 100);
    }
  }

  protected setLeafNormal(percent: number): void {
    this.leafNormal.set(percent);
    for (const sown of this.meadow?.sown ?? []) {
      const built = this.litAsBuilt.get(sown.plant.id) ?? sown.wind.ground;
      this.litAsBuilt.set(sown.plant.id, built);
      sown.wind.ground = built * (percent / 100);
    }
  }

  protected setDensity(percent: number): void {
    this.density.set(percent);
    this.meadow?.setDensity(percent / 100);

  }

  protected setHour(hour: number): void {
    this.hour.set(hour);
    this.clock.set(clockLabel(hour));
    this.stage?.setClock(hour);
  }

  protected toggleTools(): void {
    this.tools.update(open => !open);
    write('ooze.board.tools', this.tools());
  }

  protected setPan(on: boolean): void {
    this.pan.set(on);
    this.stage?.setPanMode(on);
  }

  protected recentre(): void {
    const at = this.extent;
    if (at && this.stage) {
      this.stage.frame(at.x / 2, at.y / 2, 0, Math.max(at.x, at.y));
    }
  }

  ngOnDestroy(): void {
    this.gone = true;
    window.clearInterval(this.ticker);
    this.stats?.dispose();
    this.observer?.disconnect();
    this.stones.forEach(stone => stone.dispose());
    this.proxies.forEach(proxy => proxy.dispose());
    this.meadow?.dispose();
    this.sheet?.texture.dispose();
    this.terrain?.dispose();
    this.stage?.dispose();
  }
}
