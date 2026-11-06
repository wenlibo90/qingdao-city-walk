import type { StreetEntry, WorldData } from './world/loadWorld';
import { TIME_PRESETS } from './systems/timeOfDay';

export interface TeleportTarget {
  id: string;
  name: string;
  caption: string;
  x: number;
  z: number;
  yaw: number;
}

interface UICallbacks {
  onPreset: (hour: number) => void;
  onSlider: (hour: number) => void;
  onStreet: (street: StreetEntry) => void;
  onTeleport: (target: TeleportTarget) => void;
  onToggleTour: () => void;
  onToggleView: () => void;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class UI {
  private callbacks: UICallbacks;
  private data: WorldData;
  private timeSlider = $<HTMLInputElement>('time-slider');
  private timeLabel = $<HTMLElement>('time-label');
  private phaseLabel = $<HTMLElement>('phase-label');
  private streetInput = $<HTMLInputElement>('street-input');
  private streetResults = $<HTMLDivElement>('street-results');
  private presetChips = $<HTMLDivElement>('preset-chips');
  private teleportChips = $<HTMLDivElement>('teleport-chips');
  private tourBtn = $<HTMLButtonElement>('tour-btn');
  private viewBtn = $<HTMLButtonElement>('view-btn');
  private crosshair = $<HTMLElement>('crosshair');
  private toastEl = $<HTMLDivElement>('toast');
  private modeTip = $<HTMLElement>('mode-tip');
  private loading = $<HTMLDivElement>('loading');
  private loadingStatus = $<HTMLElement>('loading-status');
  private loadingBar = $<HTMLElement>('loading-bar');
  private toastTimer = 0;
  private streetList: StreetEntry[];

  constructor(data: WorldData, callbacks: UICallbacks, targets: TeleportTarget[]) {
    this.data = data;
    this.callbacks = callbacks;
    this.streetList = data.streets;

    for (const preset of TIME_PRESETS) {
      const btn = document.createElement('button');
      btn.textContent = preset.label;
      btn.dataset.hour = String(preset.hour);
      btn.addEventListener('click', () => {
        this.callbacks.onPreset(preset.hour);
        this.setActivePreset(preset.hour);
      });
      this.presetChips.appendChild(btn);
    }

    for (const target of targets) {
      const btn = document.createElement('button');
      btn.textContent = target.name;
      btn.title = target.caption;
      btn.addEventListener('click', () => this.callbacks.onTeleport(target));
      this.teleportChips.appendChild(btn);
    }

    this.timeSlider.addEventListener('input', () => {
      const hour = parseFloat(this.timeSlider.value);
      this.callbacks.onSlider(hour);
    });

    let searchTimer = 0;
    this.streetInput.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => this.renderStreets(), 80);
    });
    this.streetInput.addEventListener('focus', () => {
      if (!this.streetInput.value) this.renderStreets('');
    });
    this.streetInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = this.streetResults.querySelector('button') as HTMLButtonElement | null;
        first?.click();
      }
      if (e.key === 'Escape') this.clearResults();
    });

    this.tourBtn.addEventListener('click', () => this.callbacks.onToggleTour());
    this.viewBtn.addEventListener('click', () => this.callbacks.onToggleView());

    $<HTMLElement>('street-count').textContent = `${data.streets.length} 条可检索街道`;
    $<HTMLElement>('stat-buildings').textContent = `${data.buildings.length} 栋建筑`;
    this.renderStreets('');
    this.clearResults();
  }

  setTime(hour: number, phase: string) {
    this.timeLabel.textContent = formatHour(hour);
    this.phaseLabel.textContent = phase;
    if (document.activeElement !== this.timeSlider) this.timeSlider.value = String(hour);
    let nearest = TIME_PRESETS[0];
    let best = Infinity;
    for (const p of TIME_PRESETS) {
      const d = Math.abs(p.hour - hour);
      if (d < best) { best = d; nearest = p; }
    }
    this.setActivePreset(best < 0.65 ? nearest.hour : -1);
  }

  private setActivePreset(hour: number) {
    for (const btn of Array.from(this.presetChips.children) as HTMLButtonElement[]) {
      btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.hour ?? '-1') - hour) < 0.01);
    }
  }

  setMode(mode: 'first' | 'third') {
    this.viewBtn.textContent = mode === 'first' ? '第三人称' : '第一人称';
    this.crosshair.classList.toggle('hidden', mode === 'third');
  }

  setTour(active: boolean) {
    this.tourBtn.textContent = active ? '退出巡游' : '自动巡游';
    this.tourBtn.classList.toggle('active', active);
    this.crosshair.classList.toggle('hidden', active);
  }

  setTourProgress(text: string) {
    this.toast(text, 0);
  }

  showCrosshair(show: boolean) {
    this.crosshair.classList.toggle('hidden', !show);
  }

  toast(message: string, duration = 2200) {
    window.clearTimeout(this.toastTimer);
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    if (duration > 0) this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), duration);
  }

  hideModeTip() {
    this.modeTip.classList.remove('show');
  }

  showModeTip() {
    this.modeTip.classList.add('show');
    window.setTimeout(() => this.modeTip.classList.remove('show'), 3400);
  }

  setLoading(text: string, progress: number) {
    this.loadingStatus.textContent = text;
    this.loadingBar.style.width = `${Math.round(progress * 100)}%`;
  }

  hideLoading() {
    this.loading.classList.add('done');
    window.setTimeout(() => { this.loading.style.display = 'none'; }, 800);
  }

  showError(message: string) {
    this.loadingStatus.textContent = message;
    this.loadingStatus.style.color = '#e98b6a';
    this.loadingBar.style.width = '100%';
    this.loadingBar.style.background = '#a33a2a';
  }

  setFps(fps: number, calls: number) {
    $<HTMLElement>('fps').textContent = `${fps.toFixed(0)} FPS`;
    $<HTMLElement>('stat-calls').textContent = `${calls} draw calls`;
  }

  setBackend(text: string) {
    $<HTMLElement>('backend-tag').textContent = text;
  }

  updateStreetCount(text: string) {
    $<HTMLElement>('street-count').textContent = text;
  }

  private clearResults() {
    this.streetResults.innerHTML = '';
    this.streetResults.style.display = 'none';
  }

  private renderStreets(query = this.streetInput.value) {
    const q = query.trim().toLowerCase();
    let list = this.streetList;
    if (q) {
      list = list.filter((s) => s.name.toLowerCase().includes(q));
      list = list.slice(0, 9);
    } else {
      list = list.slice(0, 6);
    }
    this.streetResults.innerHTML = '';
    this.streetResults.style.display = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '没有找到匹配的街道';
      this.streetResults.appendChild(empty);
      return;
    }
    for (const street of list) {
      const btn = document.createElement('button');
      btn.textContent = street.name;
      btn.setAttribute('role', 'option');
      btn.addEventListener('click', () => {
        this.callbacks.onStreet(street);
        this.streetInput.value = street.name;
        this.clearResults();
        this.streetInput.blur();
      });
      this.streetResults.appendChild(btn);
    }
  }
}

function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
