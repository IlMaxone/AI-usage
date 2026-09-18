import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { concatMap, forkJoin, from, map, of, switchMap, tap, toArray } from 'rxjs';
import { ApiService, AuthService } from './services';
import { AiModel, CostAnalysis, Dashboard, GalleryUpload, Project, Reading, UsageRecord } from './types';

type Tab = 'overview' | 'analytics' | 'projects' | 'insert' | 'records' | 'analysis' | 'models';
type AnalysisImage = GalleryUpload & { url: string };
type FileSlot = 'single' | 'start' | 'end';
type SelectedFileBatch = { count: number; name: string; size: string };
type AnalysisImageGroup = {
  key: string; recordId: string | null; mode: 'CONSTANT' | 'SEGMENT'; images: AnalysisImage[]; capturedAt: string | null;
};
type ProjectCostSummary = { project: Project; estimatedMinutes: number | null; estimatedCost: number };
type UsageChartPoint = {
  id: string; x: number; fiveHourY: number; weeklyY: number; fiveHourUsedPct: number; weeklyUsedPct: number;
  shortLabel: string; fullLabel: string;
};
const localizedDecimalPattern = /^(?:0|[1-9]\d*)(?:[.,]\d+)?$/;
const maximumBatchSize = 30;

function localDateTime(value: Date | string = new Date()) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnDestroy {
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  readonly tab = signal<Tab>('overview');
  readonly registerMode = signal(false);
  readonly loading = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  readonly dashboard = signal<Dashboard | null>(null);
  readonly projects = signal<Project[]>([]);
  readonly records = signal<UsageRecord[]>([]);
  readonly models = signal<AiModel[]>([]);
  readonly costAnalysis = signal<CostAnalysis | null>(null);
  readonly costAnalysisLoading = signal(false);
  readonly overviewCostAnalysis = signal<CostAnalysis | null>(null);
  readonly overviewCostLoading = signal(false);
  readonly costModelId = signal('');
  readonly costProjectId = signal('');
  readonly recordsProjectId = signal('');
  readonly editingProjectId = signal<string | null>(null);
  readonly editingModelId = signal<string | null>(null);
  readonly correctionTarget = signal<{ recordId: string; uploadId: string; label: string } | null>(null);
  readonly selectedFiles = signal<Record<FileSlot, SelectedFileBatch | null>>({ single: null, start: null, end: null });
  readonly uploadFeedback = signal('');
  readonly analysisImages = signal<AnalysisImage[]>([]);
  readonly analysisLoading = signal(false);
  readonly analysisProjectId = signal('');
  readonly selectedAnalysisRecordId = signal<string | null>(null);
  readonly selectedAnalysisImage = signal<AnalysisImage | null>(null);
  readonly visibleAnalysisImages = computed(() => this.analysisImages());
  readonly recordProjects = computed(() => {
    const byId = new Map(this.projects().map((project) => [project.id, project]));
    for (const record of this.records()) if (record.project) byId.set(record.project.id, record.project);
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name, 'it'));
  });
  readonly visibleRecords = computed(() => this.records().filter((record) => record.projectId === this.recordsProjectId()));
  readonly analysisImageGroups = computed<AnalysisImageGroup[]>(() => {
    const groups = new Map<string, AnalysisImageGroup>();
    for (const image of this.analysisImages()) {
      const key = image.recordId ?? `unlinked-${image.id}`;
      const existing = groups.get(key) ?? {
        key,
        recordId: image.recordId,
        mode: image.role === 'SINGLE' ? 'CONSTANT' : 'SEGMENT',
        images: [],
        capturedAt: image.capturedAt ?? image.createdAt,
      };
      existing.images.push(image);
      if (new Date(image.capturedAt ?? image.createdAt).getTime() > new Date(existing.capturedAt ?? 0).getTime()) {
        existing.capturedAt = image.capturedAt ?? image.createdAt;
      }
      groups.set(key, existing);
    }
    const roleOrder = { START: 0, END: 1, SINGLE: 0 } as const;
    for (const group of groups.values()) group.images.sort((left, right) => roleOrder[left.role] - roleOrder[right.role]);
    const target = this.selectedAnalysisRecordId();
    return [...groups.values()].sort((left, right) => {
      if (left.recordId === target) return -1;
      if (right.recordId === target) return 1;
      return new Date(right.capturedAt ?? 0).getTime() - new Date(left.capturedAt ?? 0).getTime();
    });
  });
  readonly activeValidations = computed(() => this.records().filter((item) => item.status === 'VALIDATING').length);
  readonly projectColors = [
    '#9BE15D', '#D96D4B', '#F3D5A3', '#E7A84B', '#F2C94C',
    '#88B04B', '#4F8A6D', '#4FA3A5', '#5B8DEF', '#6C7AE0',
    '#8577C9', '#B07CC6', '#D27D9A', '#E06C75', '#C95F45',
    '#8C6956', '#B59672', '#6F7D73', '#A3B18A', '#E59866',
  ] as const;
  readonly projectCostSummaries = computed<ProjectCostSummary[]>(() => {
    const analysis = this.overviewCostAnalysis();
    return this.projects().map((project) => {
      const items = analysis?.items.filter((item) => item.project?.id === project.id) ?? [];
      const estimatedMinutes = items.some((item) => item.estimatedUsageMinutes === null)
        ? null
        : items.reduce((total, item) => total + (item.estimatedUsageMinutes ?? 0), 0);
      return {
        project,
        estimatedMinutes,
        estimatedCost: items.reduce((total, item) => total + item.estimatedCost, 0),
      };
    });
  });
  readonly usageChartPoints = computed<UsageChartPoint[]>(() => {
    const records = [...(this.dashboard()?.recentRecords ?? [])]
      .filter((item) => item.observedUsage)
      .sort((left, right) => new Date(left.capturedAt || left.createdAt).getTime() - new Date(right.capturedAt || right.createdAt).getTime())
      .slice(-12);
    return records.map((record, index) => {
      const observed = record.observedUsage!;
      const capturedAt = new Date(record.capturedAt || record.createdAt);
      const x = records.length === 1 ? 495 : 58 + index * (874 / (records.length - 1));
      const y = (percentage: number) => 266 - Math.min(100, Math.max(0, percentage)) * 2.38;
      return {
        id: record.id,
        x,
        fiveHourY: y(observed.fiveHourUsedPct),
        weeklyY: y(observed.weeklyUsedPct),
        fiveHourUsedPct: observed.fiveHourUsedPct,
        weeklyUsedPct: observed.weeklyUsedPct,
        shortLabel: capturedAt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }),
        fullLabel: capturedAt.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }),
      };
    });
  });
  readonly fiveHourChartLine = computed(() => this.usageChartPoints().map((point) => `${point.x},${point.fiveHourY}`).join(' '));
  readonly weeklyChartLine = computed(() => this.usageChartPoints().map((point) => `${point.x},${point.weeklyY}`).join(' '));
  private singleFiles: File[] = [];
  private startFiles: File[] = [];
  private endFiles: File[] = [];
  private readonly fileInputs: Partial<Record<FileSlot, HTMLInputElement>> = {};
  private readonly poller: ReturnType<typeof setInterval>;

  readonly authForm = new FormGroup({
    displayName: new FormControl('', { nonNullable: true }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(12)] }),
  });
  readonly projectForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: Validators.required }),
    color: new FormControl('#9BE15D', { nonNullable: true }),
  });
  readonly editProjectForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: Validators.required }),
    color: new FormControl('#9BE15D', { nonNullable: true }),
  });
  readonly recordForm = new FormGroup({
    projectId: new FormControl('', { nonNullable: true, validators: Validators.required }),
    mode: new FormControl<'CONSTANT' | 'SEGMENT'>('CONSTANT', { nonNullable: true }),
    note: new FormControl('', { nonNullable: true }),
  });
  readonly correctionForm = new FormGroup({
    fiveHourRemainingPct: new FormControl(100, { nonNullable: true, validators: [Validators.min(0), Validators.max(100)] }),
    fiveHourResetsAt: new FormControl(localDateTime(new Date(Date.now() + 5 * 60 * 60_000)), { nonNullable: true, validators: Validators.required }),
    weeklyRemainingPct: new FormControl(100, { nonNullable: true, validators: [Validators.min(0), Validators.max(100)] }),
    weeklyResetsOn: new FormControl(new Date().toISOString().slice(0, 10), { nonNullable: true, validators: Validators.required }),
    reason: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(3)] }),
  });
  readonly modelForm = new FormGroup({
    provider: new FormControl('OpenAI', { nonNullable: true, validators: Validators.required }),
    name: new FormControl('', { nonNullable: true, validators: Validators.required }),
    reasoning: new FormControl('high', { nonNullable: true, validators: Validators.required }),
    currency: new FormControl<'USD' | 'EUR'>('USD', { nonNullable: true }),
    fiveHourWindowCost: new FormControl('0', { nonNullable: true, validators: [Validators.required, Validators.pattern(localizedDecimalPattern)] }),
    costPerMinute: new FormControl('0', { nonNullable: true, validators: [Validators.required, Validators.pattern(localizedDecimalPattern)] }),
    isDefault: new FormControl(false, { nonNullable: true }),
  });
  readonly creditsForm = new FormGroup({
    credits: new FormControl(0, { nonNullable: true, validators: Validators.min(1) }),
    paidEur: new FormControl(0, { nonNullable: true, validators: Validators.min(.01) }),
    purchasedAt: new FormControl(localDateTime(), { nonNullable: true, validators: Validators.required }),
  });

  constructor() {
    if (this.auth.user()) this.refresh();
    this.poller = setInterval(() => { if (this.auth.user() && this.activeValidations()) this.refreshRecords(); }, 4000);
  }
  ngOnDestroy() { clearInterval(this.poller); this.releaseAnalysisImages(); }
  setTab(tab: Tab) {
    this.tab.set(tab); this.clearFeedback();
    if (tab === 'records') {
      this.recordsProjectId.set(this.recordsProjectId() || this.recordProjects()[0]?.id || '');
    }
    if (tab === 'analysis') {
      this.selectedAnalysisRecordId.set(null);
      this.analysisProjectId.set(this.analysisProjectId() || this.recordProjects()[0]?.id || '');
      this.loadAnalysisImages();
    }
    if (tab === 'models') this.loadCostAnalysis();
  }

  submitAuth() {
    if (this.authForm.invalid) return;
    this.loading.set(true); this.clearFeedback();
    const { email, password, displayName } = this.authForm.getRawValue();
    const request = this.registerMode() ? this.auth.register(email, password, displayName) : this.auth.login(email, password);
    request.subscribe({ next: () => { this.loading.set(false); this.refresh(); }, error: (error) => this.fail(error) });
  }
  logout() {
    this.releaseAnalysisImages(); this.auth.logout(); this.dashboard.set(null);
    this.projects.set([]); this.records.set([]); this.models.set([]); this.costAnalysis.set(null); this.overviewCostAnalysis.set(null);
    this.recordsProjectId.set(''); this.analysisProjectId.set(''); this.selectedAnalysisRecordId.set(null);
  }
  refresh(preserveFeedback = false) {
    this.loading.set(true); if (!preserveFeedback) this.clearFeedback();
    forkJoin({ dashboard: this.api.dashboard(), projects: this.api.projects(), records: this.api.records(), models: this.api.models() }).subscribe({
      next: ({ dashboard, projects, records, models }) => {
        this.dashboard.set(dashboard); this.projects.set(projects); this.records.set(records); this.models.set(models);
        this.applyDefaults(projects, models); this.loading.set(false);
        this.loadOverviewCostAnalysis();
        if (this.tab() === 'models') this.loadCostAnalysis();
      },
      error: (error) => this.fail(error),
    });
  }

  createProject() {
    if (this.projectForm.invalid) return;
    this.api.createProject(this.projectForm.getRawValue()).subscribe({
      next: () => { this.projectForm.reset({ name: '', color: '#9BE15D' }); this.succeed('Progetto creato.'); this.refresh(true); },
      error: (error) => this.fail(error),
    });
  }
  editProject(project: Project) { this.editingProjectId.set(project.id); this.editProjectForm.setValue({ name: project.name, color: project.color }); }
  chooseProjectColor(color: string, editing = false) {
    (editing ? this.editProjectForm : this.projectForm).controls.color.setValue(color);
  }
  saveProject(id: string) {
    if (this.editProjectForm.invalid) return;
    this.api.updateProject(id, this.editProjectForm.getRawValue()).subscribe({
      next: () => { this.editingProjectId.set(null); this.succeed('Progetto aggiornato.'); this.refresh(true); },
      error: (error) => this.fail(error),
    });
  }
  deleteProject(id: string) {
    if (!window.confirm('Eliminare il progetto? Le rilevazioni storiche resteranno tracciate.')) return;
    this.api.deleteProject(id).subscribe({ next: () => { this.succeed('Progetto eliminato.'); this.refresh(true); }, error: (error) => this.fail(error) });
  }

  chooseFile(slot: FileSlot, event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    this.fileInputs[slot] = input;
    if (files.length > maximumBatchSize) {
      this.error.set(`Puoi caricare al massimo ${maximumBatchSize} immagini per selezione.`);
      input.value = ''; this.setSlotFiles(slot, []); return;
    }
    if (files.some((file) => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) {
      this.error.set('Uno o più file hanno un formato non supportato: usa PNG, JPEG o WebP.');
      input.value = ''; this.setSlotFiles(slot, []); return;
    }
    if (files.some((file) => file.size > 10_485_760)) {
      this.error.set('Una o più immagini superano il limite di 10 MB per file.');
      input.value = ''; this.setSlotFiles(slot, []); return;
    }
    this.setSlotFiles(slot, files);
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    this.selectedFiles.update((current) => ({
      ...current,
      [slot]: files.length ? {
        count: files.length,
        name: files.length === 1 ? files[0]!.name : `${files.length} immagini selezionate`,
        size: `${(totalBytes / 1_048_576).toFixed(2)} MB totali`,
      } : null,
    }));
    this.uploadFeedback.set(files.length ? `${files.length} ${files.length === 1 ? 'immagine selezionata' : 'immagini selezionate'} per ${slot === 'single' ? 'batch separati' : slot === 'start' ? 'gli inizi' : 'le fini'}.` : '');
    this.error.set('');
  }
  batchReady() {
    const selected = this.selectedFiles();
    return this.recordForm.controls.mode.value === 'CONSTANT'
      ? Boolean(selected.single?.count)
      : Boolean(selected.start?.count && selected.start.count === selected.end?.count);
  }
  plannedBatchCount() {
    const selected = this.selectedFiles();
    return this.recordForm.controls.mode.value === 'CONSTANT' ? selected.single?.count ?? 0 : selected.start?.count ?? 0;
  }
  startValidation() {
    if (this.recordForm.invalid) return;
    const value = this.recordForm.getRawValue();
    if (value.mode === 'CONSTANT' && !this.singleFiles.length) { this.error.set('Seleziona almeno uno screenshot della rilevazione.'); return; }
    if (value.mode === 'SEGMENT' && (!this.startFiles.length || !this.endFiles.length)) { this.error.set('Seleziona gli screenshot iniziali e finali.'); return; }
    if (value.mode === 'SEGMENT' && this.startFiles.length !== this.endFiles.length) {
      this.error.set(`Le selezioni non coincidono: ${this.startFiles.length} immagini iniziali e ${this.endFiles.length} finali.`); return;
    }
    const batchCount = value.mode === 'CONSTANT' ? this.singleFiles.length : this.startFiles.length;
    const body = new FormData();
    body.append('projectId', value.projectId); body.append('mode', value.mode);
    if (value.note) body.append('note', value.note);
    if (value.mode === 'CONSTANT') this.singleFiles.forEach((file) => body.append('single', file));
    else {
      this.startFiles.forEach((file) => body.append('start', file));
      this.endFiles.forEach((file) => body.append('end', file));
    }
    this.loading.set(true); this.clearFeedback();
    this.uploadFeedback.set(`Caricamento di ${batchCount} ${batchCount === 1 ? 'batch' : 'batch separati'}…`);
    this.api.createRecordBatch(body).pipe(
      tap((records) => this.uploadFeedback.set(`${records.length} ${records.length === 1 ? 'batch creato' : 'batch creati'}. Avvio delle verifiche OCR separate…`)),
      switchMap((records) => from(records).pipe(concatMap((record) => this.api.validateRecord(record.id)), toArray())),
    ).subscribe({
      next: () => {
        this.loading.set(false); this.clearSelectedFiles();
        this.uploadFeedback.set(`${batchCount} ${batchCount === 1 ? 'batch ricevuto' : 'batch ricevuti'} e ${batchCount === 1 ? 'inviato' : 'inviati'} alla tripla verifica OCR.`);
        this.recordForm.controls.note.setValue(''); this.succeed(`${batchCount} ${batchCount === 1 ? 'rilevazione caricata' : 'rilevazioni caricate'} correttamente.`);
        this.recordsProjectId.set(value.projectId);
        this.tab.set('records'); this.refresh(true);
      },
      error: (error) => { this.uploadFeedback.set(''); this.fail(error); },
    });
  }
  private setSlotFiles(slot: FileSlot, files: File[]) {
    if (slot === 'single') this.singleFiles = files;
    else if (slot === 'start') this.startFiles = files;
    else this.endFiles = files;
  }
  private clearSelectedFiles() {
    this.singleFiles = []; this.startFiles = []; this.endFiles = [];
    this.selectedFiles.set({ single: null, start: null, end: null });
    for (const input of Object.values(this.fileInputs)) if (input) input.value = '';
  }
  retryValidation(id: string) {
    this.api.validateRecord(id).subscribe({ next: () => { this.succeed('Tripla verifica OCR riavviata.'); this.refresh(true); }, error: (error) => this.fail(error) });
  }
  deleteRecord(id: string) {
    if (!window.confirm('Eliminare questa rilevazione dalla vista? OCR e audit resteranno tracciati.')) return;
    this.api.deleteRecord(id).subscribe({ next: () => { this.succeed('Rilevazione eliminata dalla vista.'); this.refresh(true); }, error: (error) => this.fail(error) });
  }
  openCorrection(recordId: string, reading: Reading, label: string) {
    if (!reading.upload) return;
    const source = reading.effectiveSnapshot;
    this.correctionTarget.set({ recordId, uploadId: reading.upload.id, label });
    this.correctionForm.setValue({
      fiveHourRemainingPct: Number(source?.fiveHourRemainingPct ?? 100),
      fiveHourResetsAt: localDateTime(source?.fiveHourResetsAt ?? new Date(Date.now() + 5 * 60 * 60_000)),
      weeklyRemainingPct: Number(source?.weeklyRemainingPct ?? 100),
      weeklyResetsOn: source?.weeklyResetsOn?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      reason: '',
    });
  }
  saveCorrection() {
    const target = this.correctionTarget();
    if (!target || this.correctionForm.invalid) return;
    const value = this.correctionForm.getRawValue();
    this.api.correctReading(target.recordId, target.uploadId, {
      ...value,
      fiveHourRemainingPct: Number(value.fiveHourRemainingPct),
      fiveHourResetsAt: new Date(value.fiveHourResetsAt).toISOString(),
      weeklyRemainingPct: Number(value.weeklyRemainingPct),
    }).subscribe({
      next: () => { this.correctionTarget.set(null); this.succeed('Correzione registrata senza sovrascrivere la lettura OCR.'); this.refresh(true); },
      error: (error) => this.fail(error),
    });
  }

  createModel() {
    if (this.modelForm.invalid) return;
    const value = this.modelForm.getRawValue();
    const fiveHourWindowCost = this.parseLocalizedDecimal(value.fiveHourWindowCost);
    const costPerMinute = this.parseLocalizedDecimal(value.costPerMinute);
    if (!Number.isFinite(fiveHourWindowCost) || !Number.isFinite(costPerMinute)) {
      this.error.set('Inserisci costi validi, usando la virgola o il punto come separatore decimale.');
      return;
    }
    const payload = { provider: value.provider, name: value.name, reasoning: value.reasoning, isDefault: value.isDefault, pricing: {
      currency: value.currency, fiveHourWindowCost, costPerMinute,
    } };
    const request = this.editingModelId()
      ? this.api.updateModel(this.editingModelId()!, payload)
      : this.api.createModel(payload);
    request.subscribe({
      next: () => { this.cancelModelEdit(); this.succeed('Modello salvato.'); this.refresh(true); },
      error: (error) => this.fail(error),
    });
  }
  draftMaximumMinutes() {
    const maximumWindowCost = this.parseLocalizedDecimal(this.modelForm.controls.fiveHourWindowCost.value);
    const costPerMinute = this.parseLocalizedDecimal(this.modelForm.controls.costPerMinute.value);
    return Number.isFinite(maximumWindowCost) && Number.isFinite(costPerMinute) && costPerMinute > 0
      ? maximumWindowCost / costPerMinute
      : null;
  }
  editModel(model: AiModel) {
    this.editingModelId.set(model.id);
    this.modelForm.setValue({
      provider: model.provider,
      name: model.name,
      reasoning: model.reasoning,
      currency: model.pricing.currency,
      fiveHourWindowCost: this.formatLocalizedDecimal(model.pricing.fiveHourWindowCost),
      costPerMinute: this.formatLocalizedDecimal(model.pricing.costPerMinute),
      isDefault: model.isDefault,
    });
  }
  cancelModelEdit() {
    this.editingModelId.set(null);
    this.modelForm.reset({ provider: 'OpenAI', name: '', reasoning: 'high', currency: 'USD', fiveHourWindowCost: '0', costPerMinute: '0', isDefault: false });
  }
  selectCostModel(modelId: string) {
    this.costModelId.set(modelId); this.loadCostAnalysis(); this.loadOverviewCostAnalysis(modelId);
  }
  selectCostProject(projectId: string) {
    this.costProjectId.set(projectId); this.loadCostAnalysis();
  }
  loadCostAnalysis() {
    const modelId = this.costModelId() || this.models().find((item) => item.isDefault)?.id || this.models()[0]?.id;
    if (!modelId) { this.costAnalysis.set(null); return; }
    this.costModelId.set(modelId); this.costAnalysisLoading.set(true);
    this.api.costAnalysis(modelId, this.costProjectId() || undefined).subscribe({
      next: (analysis) => { this.costAnalysis.set(analysis); this.costAnalysisLoading.set(false); },
      error: (error) => { this.costAnalysisLoading.set(false); this.fail(error); },
    });
  }
  loadOverviewCostAnalysis(requestedModelId?: string) {
    const modelId = requestedModelId || this.costModelId() || this.models().find((item) => item.isDefault)?.id || this.models()[0]?.id;
    if (!modelId) { this.overviewCostAnalysis.set(null); return; }
    this.overviewCostLoading.set(true);
    this.api.costAnalysis(modelId).subscribe({
      next: (analysis) => { this.overviewCostAnalysis.set(analysis); this.overviewCostLoading.set(false); },
      error: (error) => { this.overviewCostLoading.set(false); this.fail(error); },
    });
  }
  addCredits() {
    if (this.creditsForm.invalid) return;
    const value = this.creditsForm.getRawValue();
    this.api.addCredits({ credits: Number(value.credits), paidEur: Number(value.paidEur), purchasedAt: new Date(value.purchasedAt).toISOString() }).subscribe({
      next: () => { this.succeed('Acquisto registrato come interamente speso.'); this.refresh(true); }, error: (error) => this.fail(error),
    });
  }

  statusLabel(status: string) {
    return ({ MEASURED: 'Usage misurato', SEGMENT_MEASURED: 'Segmento misurato', WAITING_FOR_OCR: 'In attesa OCR', WINDOW_MISMATCH: 'Finestre 5h diverse', DRAFT: 'Bozza', VALIDATING: 'Tripla verifica', VALIDATED: 'Validata', MANUAL_REVIEW: 'Da correggere', FAILED: 'Errore' } as Record<string, string>)[status] ?? status;
  }
  uploadStatus(status: string) {
    return ({ DRAFT: 'Pronto', UPLOADED: 'In coda', PROCESSING: 'OCR in corso', VALIDATED: 'Validato', MANUAL_REVIEW: 'Verifica manuale', FAILED: 'Errore' } as Record<string, string>)[status] ?? status;
  }
  weeklySignalLabel(signal: NonNullable<UsageRecord['usage']['alignment']>['weeklyResetSignal']) {
    return ({
      SAME_WINDOW: 'reset settimanale coerente',
      ROLLOVER: 'passaggio alla settimana successiva',
      SHIFTED: 'reset settimanale spostato, non bloccante',
      UNAVAILABLE: 'reset settimanale non disponibile',
    } as const)[signal];
  }
  readings(record: UsageRecord) {
    return record.mode === 'CONSTANT'
      ? [{ value: record.single, label: 'Screenshot usage' }]
      : [{ value: record.start, label: 'Screenshot iniziale' }, { value: record.end, label: 'Screenshot finale' }];
  }
  recordCapturedAt(record: UsageRecord) {
    const reading = record.mode === 'SEGMENT' ? record.end : record.single;
    return reading?.rawSnapshot?.capturedAt ?? record.createdAt;
  }
  roleLabel(role: GalleryUpload['role']) {
    return ({ SINGLE: 'Screenshot singolo', START: 'Inizio segmento', END: 'Fine segmento' } as const)[role];
  }
  selectRecordsProject(projectId: string) {
    this.recordsProjectId.set(projectId); this.correctionTarget.set(null);
  }
  openRecordImages(record: UsageRecord) {
    this.analysisProjectId.set(record.projectId);
    this.selectedAnalysisRecordId.set(record.id);
    this.selectedAnalysisImage.set(null);
    this.tab.set('analysis'); this.clearFeedback(); this.loadAnalysisImages();
  }
  loadAnalysisImages() {
    const projectId = this.analysisProjectId();
    if (!projectId) { this.releaseAnalysisImages(); this.analysisLoading.set(false); return; }
    this.analysisLoading.set(true); this.selectedAnalysisImage.set(null);
    this.api.gallery(projectId).pipe(
      switchMap((items) => items.length
        ? forkJoin(items.map((item) => this.api.uploadImage(item.id).pipe(
            map((blob) => ({ ...item, url: URL.createObjectURL(blob) })),
          )))
        : of([] as AnalysisImage[])),
    ).subscribe({
      next: (items) => {
        this.releaseAnalysisImages(); this.analysisImages.set(items); this.analysisLoading.set(false);
      },
      error: (error) => { this.analysisLoading.set(false); this.fail(error); },
    });
  }
  selectAnalysisProject(projectId: string) {
    this.analysisProjectId.set(projectId); this.selectedAnalysisRecordId.set(null); this.loadAnalysisImages();
  }
  private releaseAnalysisImages() {
    for (const item of this.analysisImages()) URL.revokeObjectURL(item.url);
    this.analysisImages.set([]); this.selectedAnalysisImage.set(null);
  }
  tabTitle() {
    return ({
      overview: 'La scrivania', analytics: 'Analisi usage', projects: 'I progetti', insert: 'Nuova lettura', records: 'Archivio usage',
      analysis: 'Analisi immagini', models: 'Modelli e conti',
    } as Record<Tab, string>)[this.tab()];
  }
  private refreshRecords() {
    this.api.records().subscribe((records) => {
      const wasActive = this.activeValidations() > 0; this.records.set(records);
      if (wasActive && this.activeValidations() === 0) this.refresh();
    });
  }
  private applyDefaults(projects: Project[], models: AiModel[]) {
    const projectId = this.recordForm.controls.projectId.value || projects[0]?.id || '';
    this.recordForm.patchValue({ projectId });
    const recordProjectIds = new Set(this.recordProjects().map((project) => project.id));
    if (!recordProjectIds.has(this.recordsProjectId())) this.recordsProjectId.set(this.recordProjects()[0]?.id || '');
    if (!recordProjectIds.has(this.analysisProjectId())) this.analysisProjectId.set(projects[0]?.id || '');
    if (!models.some((model) => model.id === this.costModelId())) {
      this.costModelId.set(models.find((item) => item.isDefault)?.id || models[0]?.id || '');
    }
  }
  private parseLocalizedDecimal(value: string) {
    return Number(value.trim().replace(',', '.'));
  }
  private formatLocalizedDecimal(value: number) {
    return Number(value).toLocaleString('it-IT', { useGrouping: false, maximumFractionDigits: 20 });
  }
  private clearFeedback() { this.message.set(''); this.error.set(''); }
  private succeed(message: string) { this.error.set(''); this.message.set(message); }
  private fail(error: HttpErrorResponse) {
    this.loading.set(false);
    const message = Array.isArray(error.error?.message) ? error.error.message.join(' · ') : error.error?.message;
    this.error.set(message || 'Operazione non riuscita. Riprova.'); if (error.status === 401) this.logout();
  }
}
