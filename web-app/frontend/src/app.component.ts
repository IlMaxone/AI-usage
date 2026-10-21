import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { concatMap, forkJoin, from, map, of, Subscription, switchMap, tap, toArray } from 'rxjs';
import { ApiService, AuthService } from './services';
import { AiModel, CostAnalysis, Dashboard, GalleryUpload, Project, Reading, UsageRecord, OcrFailureNotification } from './types';
import { pairUploadFiles } from './pair-files';
import { groupModels, variantOrder } from './model-groups';
import { ModelReasoningComponent } from './model-reasoning.component';
import { OcrDebugConsoleComponent } from './ocr-debug-console.component';

type Tab = 'overview' | 'analytics' | 'projects' | 'insert' | 'records' | 'models' | 'profile';
type ArchiveImage = GalleryUpload & { url: string };
type FileSlot = 'single' | 'pairs';
type SelectedFileBatch = { count: number; name: string; size: string };
type RecordImages = { loading: boolean; images: ArchiveImage[]; error: string };
type ProjectCostSummary = {
  project: Project;
  modelNames: string;
  unpricedRecords: number;
  estimatedMinutes: number | null;
  estimatedCost: number;
};
type UsageChartPoint = {
  id: string; x: number; fiveHourY: number; weeklyY: number; fiveHourUsedPct: number; weeklyUsedPct: number;
  shortLabel: string; fullLabel: string;
};

const maximumBatchSize = 30;

function localDateTime(value: Date | string = new Date()) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ModelReasoningComponent, OcrDebugConsoleComponent],
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
  readonly ocrFailures = signal<OcrFailureNotification[]>([]);
  readonly debugConsoleOpen = signal(false);
  readonly retryOcrBusy = signal(false);
  readonly resetOcrBusy = signal(false);
  readonly failureModelDrafts = signal<Partial<Record<string, string>>>({});
  readonly failureModelSaving = signal<string | null>(null);
  readonly projects = signal<Project[]>([]);
  readonly records = signal<UsageRecord[]>([]);
  readonly models = signal<AiModel[]>([]);
  readonly expandedModelGroups = signal<ReadonlySet<string>>(new Set());
  readonly modelGroups = computed(() => groupModels(this.models()));
  readonly costAnalysis = signal<CostAnalysis | null>(null);
  readonly costAnalysisLoading = signal(false);
  readonly explorationEnabled = signal(false);
  readonly fixedWindow = signal<{ currency: 'EUR'; fiveHourWindowCost: number } | null>(null);
  private costRequest = 0;
  readonly overviewProjectAnalyses = signal<ReadonlyMap<string, CostAnalysis>>(new Map());
  readonly overviewCostLoading = signal(false);
  readonly costModelId = signal('');
  readonly costProjectId = signal('');
  readonly recordsProjectId = signal('');
  readonly editingProjectId = signal<string | null>(null);

  readonly correctionTarget = signal<{ recordId: string; uploadId: string; label: string } | null>(null);
  readonly selectedFiles = signal<Record<FileSlot, SelectedFileBatch | null>>({ single: null, pairs: null });
  readonly pairSource = signal<'FILES' | 'FOLDER'>('FILES');
  readonly pairPlan = signal<ReturnType<typeof pairUploadFiles<File>>>({ pairs: [], issues: [] });
  readonly uploadFeedback = signal('');
  readonly pickerBusy = signal(false);
  readonly inboxFiles = signal<string[]>([]);
  readonly inboxIssues = signal<Array<{ number: string; reason: string }>>([]);
  readonly projectInboxPath = computed(() => {
    const project = this.projects().find((item) => item.id === this.inboxProjectId());
    return project?.folder ? `${project.folder}/to-process` : '';
  });
  readonly inboxProjectId = signal('');
  readonly expandedRecordIds = signal<ReadonlySet<string>>(new Set());
  readonly recordImages = signal<Record<string, RecordImages>>({});
  readonly selectedImage = signal<ArchiveImage | null>(null);
  private readonly imageRequests = new Map<string, Subscription>();
  readonly recordProjects = computed(() => {
    const byId = new Map(this.projects().map((project) => [project.id, project]));
    for (const record of this.records()) if (record.project) byId.set(record.project.id, record.project);
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name, 'it'));
  });
  readonly visibleRecords = computed(() => this.records().filter((record) => record.projectId === this.recordsProjectId()));
  readonly activeValidations = computed(() => this.records().filter((item) => item.status === 'VALIDATING').length);
  readonly retryingRecordIds = signal<ReadonlySet<string>>(new Set());
  readonly projectColors = [
    '#9BE15D', '#D96D4B', '#F3D5A3', '#E7A84B', '#F2C94C',
    '#88B04B', '#4F8A6D', '#4FA3A5', '#5B8DEF', '#6C7AE0',
    '#8577C9', '#B07CC6', '#D27D9A', '#E06C75', '#C95F45',
    '#8C6956', '#B59672', '#6F7D73', '#A3B18A', '#E59866',
  ] as const;
  readonly projectCostSummaries = computed<ProjectCostSummary[]>(() => {
    const analyses = this.overviewProjectAnalyses();
    return this.projects().map((project) => {
      const analysis = analyses.get(project.id);
      const items = analysis?.items.filter((item) => item.project?.id === project.id) ?? [];
      const estimatedMinutes = items.some((item) => item.estimatedUsageMinutes === null)
        ? null
        : items.reduce((total, item) => total + (item.estimatedUsageMinutes ?? 0), 0);
      return {
        project,
        modelNames: [...new Set(items.flatMap((item) => item.sourceModel ? [item.sourceModel.name + ' · ' + this.reasoningLabel(item.sourceModel.reasoning)] : []))].join(', ') || 'In attesa del tag OCR',
        unpricedRecords: analysis?.summary.unpricedRecords ?? 0,
        estimatedMinutes,
        estimatedCost: items.reduce((total, item) => total + (item.estimatedCost ?? 0), 0),
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
  readonly creditsForm = new FormGroup({
    credits: new FormControl(0, { nonNullable: true, validators: Validators.min(1) }),
    paidEur: new FormControl(0, { nonNullable: true, validators: Validators.min(.01) }),
    purchasedAt: new FormControl(localDateTime(), { nonNullable: true, validators: Validators.required }),
  });

  constructor() {
    if (this.auth.user()) this.refresh();
    this.poller = setInterval(() => {
      if (!this.auth.user()) return;
      this.refreshOcrFailures();
      const pendingTags = this.records().some((record) => [record.single, record.start, record.end].some((reading) => reading?.upload && ['VALIDATED', 'PROCESSING'].includes(reading.upload.status) && !reading.upload.modelId));
      if (this.activeValidations() || pendingTags || ['insert', 'records'].includes(this.tab())) this.refreshRecords();
      if (this.tab() === 'insert' && this.recordForm.controls.mode.value === 'SEGMENT') this.refreshInbox();
    }, 4000);
  }
  ngOnDestroy() { clearInterval(this.poller); this.releaseAllRecordImages(); }
  setTab(tab: Tab) {
    if (tab !== 'profile') this.debugConsoleOpen.set(false);
    if (tab !== 'records') this.releaseAllRecordImages();
    if (tab !== 'analytics') { this.explorationEnabled.set(false); this.costModelId.set(''); this.costAnalysis.set(null); this.costRequest++; }
    this.tab.set(tab); this.clearFeedback();
    if (tab === 'records') {
      this.recordsProjectId.set(this.recordsProjectId() || this.recordProjects()[0]?.id || '');
    }
    if (tab === 'analytics') this.loadCostAnalysis();
    if (tab === 'insert') this.refreshInbox();
  }

  submitAuth() {
    if (this.authForm.invalid) return;
    this.loading.set(true); this.clearFeedback();
    const { email, password, displayName } = this.authForm.getRawValue();
    const request = this.registerMode() ? this.auth.register(email, password, displayName) : this.auth.login(email, password);
    request.subscribe({ next: () => { this.loading.set(false); this.refresh(); }, error: (error) => this.fail(error) });
  }
  logout() {
    this.debugConsoleOpen.set(false);
    this.explorationEnabled.set(false); this.costModelId.set(''); this.costRequest++;
    this.releaseAllRecordImages(); this.auth.logout(); this.dashboard.set(null);
    this.projects.set([]); this.records.set([]); this.models.set([]); this.costAnalysis.set(null);
    this.overviewProjectAnalyses.set(new Map());
    this.recordsProjectId.set(''); this.clearSelectedFiles(); this.ocrFailures.set([]);
  }
  refresh(preserveFeedback = false) {
    this.loading.set(true); if (!preserveFeedback) this.clearFeedback();
    forkJoin({ dashboard: this.api.dashboard(), projects: this.api.projects(), records: this.api.records(), models: this.api.models(), window: this.api.windowPricing(), failures: this.api.ocrFailures() }).subscribe({
      next: ({ dashboard, projects, records, models, window, failures }) => {
        this.ocrFailures.set(failures);
        this.fixedWindow.set(window);
        this.dashboard.set(dashboard); this.projects.set(projects); this.records.set(records); this.models.set(models);
        this.applyDefaults(projects, models); this.loading.set(false);
        this.loadOverviewCostAnalysis();
        if (this.tab() === 'analytics') this.loadCostAnalysis();
      },
      error: (error) => this.fail(error),
    });
  }

  createProject() {
    if (this.projectForm.invalid) return;
    this.api.createProject(this.projectForm.getRawValue()).subscribe({
      next: () => {
        this.projectForm.reset({ name: '', color: '#9BE15D' });
        this.succeed('Progetto creato.'); this.refresh(true);
      },
      error: (error) => this.fail(error),
    });
  }
  editProject(project: Project) {
    this.editingProjectId.set(project.id);
    this.editProjectForm.setValue({ name: project.name, color: project.color });
  }
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
    this.uploadFeedback.set('');
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    this.fileInputs[slot] = input;
    const maximumFiles = slot === 'pairs' ? maximumBatchSize * 2 : maximumBatchSize;
    if (files.length > maximumFiles) {
      this.error.set(`Puoi caricare al massimo ${maximumFiles} immagini per selezione.`);
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
    this.uploadFeedback.set(files.length ? slot === 'pairs' ? `${this.pairPlan().pairs.length} coppie complete selezionate.` : `${files.length} ${files.length === 1 ? 'immagine selezionata' : 'immagini selezionate'} per letture separate.` : '');
    this.error.set('');
  }
  refreshInbox() {
    const id = this.recordForm.controls.projectId.value;
    if (id !== this.inboxProjectId()) this.inboxIssues.set([]);
    this.inboxProjectId.set(id);
    if (!id) { this.inboxFiles.set([]); return; }
    this.api.projectInbox(id).subscribe({
      next: (inbox) => { if (id === this.recordForm.controls.projectId.value) this.inboxFiles.set(inbox.files); },
      error: (error) => this.fail(error),
    });
  }
  selectProjectImages() {
    const id = this.recordForm.controls.projectId.value;
    if (!id || this.pickerBusy()) return;
    this.pickerBusy.set(true); this.clearFeedback();
    this.api.selectProjectImages(id).subscribe({
      next: (result) => {
        this.pickerBusy.set(false);
        if (!result.cancelled) this.succeed(`${result.copied} immagini nella cartella del progetto. Il worker elaborerà le coppie A/B automaticamente.`);
        this.refreshInbox();
      },
      error: (error: HttpErrorResponse) => {
        this.pickerBusy.set(false);
        if (error.status === 0) this.error.set('Il selettore Windows non è raggiungibile. Avvia l’app con npm run start:windows dalla cartella web-app.');
        else this.fail(error);
      },
    });
  }
  scanProjectFolder() {
    const id = this.recordForm.controls.projectId.value;
    if (!id) return;
    this.loading.set(true); this.clearFeedback();
    this.api.scanInbox(id).subscribe({
      next: (result) => {
        this.loading.set(false); this.inboxIssues.set(result.pending); this.refreshInbox(); this.refreshRecords();
        this.succeed(`${result.imported} coppie accodate. I file già in coda o invariati restano senza duplicati.`);
      }, error: (error) => this.fail(error),
    });
  }
  batchReady() {
    return this.recordForm.controls.mode.value === 'CONSTANT' ? Boolean(this.selectedFiles().single?.count)
      : this.pairPlan().pairs.length > 0 && !this.pairPlan().issues.length;
  }
  plannedBatchCount() {
    return this.recordForm.controls.mode.value === 'CONSTANT' ? this.selectedFiles().single?.count ?? 0 : this.pairPlan().pairs.length;
  }
  changeUploadMode() { this.clearSelectedFiles(); this.uploadFeedback.set(''); this.clearFeedback(); this.refreshInbox(); }
  changePairSource(source: 'FILES' | 'FOLDER') { this.pairSource.set(source); this.changeUploadMode(); }
  startValidation() {
    if (this.recordForm.invalid || this.loading()) return;
    const value = this.recordForm.getRawValue();
    if (value.mode === 'SEGMENT' && this.pairSource() === 'FOLDER') { this.scanProjectFolder(); return; }
    if (!this.batchReady()) { this.error.set(value.mode === 'CONSTANT' ? 'Seleziona almeno uno screenshot.' : 'Seleziona coppie A/B complete e senza nomi ambigui.'); return; }
    const batchCount = this.plannedBatchCount();
    const body = new FormData();
    body.append('projectId', value.projectId); body.append('mode', value.mode);
    if (value.note) body.append('note', value.note);
    if (value.mode === 'CONSTANT') this.singleFiles.forEach((file) => body.append('single', file));
    else for (const pair of this.pairPlan().pairs) { body.append('start', pair.start); body.append('end', pair.end); }
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
    else this.pairPlan.set(pairUploadFiles(files));
    if (!files.length) this.selectedFiles.update((current) => ({ ...current, [slot]: null }));
  }
  private clearSelectedFiles() {
    this.singleFiles = [];
    this.selectedFiles.set({ single: null, pairs: null });
    this.pairPlan.set({ pairs: [], issues: [] });
    for (const input of Object.values(this.fileInputs)) if (input) input.value = '';
  }
  retryValidation(id: string) {
    if (this.retryingRecordIds().has(id)) return;
    this.retryingRecordIds.update((current) => new Set([...current, id]));
    this.succeed('Riaccodamento della tripla verifica OCR…');
    this.api.validateRecord(id).subscribe({
      next: (result) => {
        this.retryingRecordIds.update((current) => new Set([...current].filter((item) => item !== id)));
        this.succeed(`${result.queuedUploads} ${result.queuedUploads === 1 ? 'screenshot riaccodato' : 'screenshot riaccodati'}: OCR in corso.`);
        this.refresh(true);
      },
      error: (error) => {
        this.retryingRecordIds.update((current) => new Set([...current].filter((item) => item !== id)));
        this.fail(error);
      },
    });
  }
  deleteRecord(id: string) {
    if (!window.confirm('Eliminare la rilevazione dall’app? Gli screenshot saranno conservati nella cartella deleted del progetto e potranno essere recuperati.')) return;
    this.api.deleteRecord(id).subscribe({
      next: () => { this.releaseRecordImages(id); this.expandedRecordIds.update((ids) => new Set([...ids].filter((item) => item !== id))); this.succeed('Rilevazione eliminata. Screenshot conservati in deleted nella cartella del progetto.'); this.refresh(true); },
      error: (error) => this.fail(error),
    });
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

  toggleExploration() {
    const enabled = !this.explorationEnabled();
    this.explorationEnabled.set(enabled);
    this.costModelId.set(enabled ? this.models().find((model) => model.pricing.costPerMinute > 0)?.id ?? '' : '');
    this.loadCostAnalysis();
  }
  selectCostModel(modelId: string) {
    if (!this.explorationEnabled()) return;
    this.costModelId.set(modelId); this.loadCostAnalysis();
  }
  selectCostProject(projectId: string) {
    this.costProjectId.set(projectId); this.loadCostAnalysis();
  }
  loadCostAnalysis() {
    const request = ++this.costRequest;
    const modelId = this.explorationEnabled() ? this.costModelId() : '';
    if (this.explorationEnabled() && !modelId) { this.costAnalysis.set(null); return; }
    this.costAnalysisLoading.set(true);
    this.api.costAnalysis(this.costProjectId() || undefined, modelId || undefined).subscribe({
      next: (analysis) => { if (request !== this.costRequest) return; this.costAnalysis.set(analysis); this.costAnalysisLoading.set(false); },
      error: (error) => { if (request !== this.costRequest) return; this.costAnalysisLoading.set(false); this.fail(error); },
    });
  }
  loadOverviewCostAnalysis() {
    const requests = this.projects().map((project) => this.api.costAnalysis(project.id).pipe(map((analysis) => [project.id, analysis] as const)));
    if (!requests.length) {
      this.overviewProjectAnalyses.set(new Map());
      this.overviewCostLoading.set(false);
      return;
    }
    this.overviewCostLoading.set(true);
    forkJoin(requests).subscribe({
      next: (entries) => {
        this.overviewProjectAnalyses.set(new Map(entries));
        this.overviewCostLoading.set(false);
      },
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
    this.releaseAllRecordImages(); this.recordsProjectId.set(projectId); this.correctionTarget.set(null);
  }
  refreshArchive() { this.releaseAllRecordImages(); this.refresh(); }
  toggleRecordImages(record: UsageRecord) {
    if (this.expandedRecordIds().has(record.id)) {
      this.expandedRecordIds.update((ids) => new Set([...ids].filter((id) => id !== record.id)));
      this.releaseRecordImages(record.id); return;
    }
    this.expandedRecordIds.update((ids) => new Set([...ids, record.id]));
    this.recordImages.update((state) => ({ ...state, [record.id]: { loading: true, images: [], error: '' } }));
    const request = this.api.gallery(record.projectId).pipe(
      map((items) => items.filter((item) => item.recordId === record.id).sort((a, b) => (a.role === 'END' ? 1 : 0) - (b.role === 'END' ? 1 : 0))),
      switchMap((items) => items.length ? forkJoin(items.map((item) => this.api.uploadImage(item.id).pipe(map((blob) => ({ item, blob }))))) : of([])),
    ).subscribe({
      next: (items) => {
        if (!this.expandedRecordIds().has(record.id) || this.recordsProjectId() !== record.projectId) return;
        const images = items.map(({ item, blob }) => ({ ...item, url: URL.createObjectURL(blob) }));
        this.recordImages.update((state) => ({ ...state, [record.id]: { loading: false, images, error: '' } }));
      },
      error: () => this.recordImages.update((state) => ({ ...state, [record.id]: { loading: false, images: [], error: 'Screenshot non disponibili. Chiudi e riapri per riprovare.' } })),
    });
    this.imageRequests.set(record.id, request);
  }
  private releaseRecordImages(id: string) {
    this.imageRequests.get(id)?.unsubscribe(); this.imageRequests.delete(id);
    for (const image of this.recordImages()[id]?.images ?? []) URL.revokeObjectURL(image.url);
    if (this.selectedImage()?.recordId === id) this.selectedImage.set(null);
    this.recordImages.update((state) => { const copy = { ...state }; delete copy[id]; return copy; });
  }
  private releaseAllRecordImages() {
    for (const id of this.imageRequests.keys()) this.releaseRecordImages(id);
    this.expandedRecordIds.set(new Set()); this.selectedImage.set(null);
  }
  tabTitle() {
    return ({
      overview: 'La scrivania', analytics: 'Analisi usage', projects: 'I progetti', insert: 'Nuova lettura', records: 'Archivio usage',
      models: 'Modelli', profile: 'Profilo',
    } as Record<Tab, string>)[this.tab()];
  }
  private refreshRecords() {
    this.api.records().subscribe((records) => {
      const tags = (items: UsageRecord[]) => items.flatMap((record) => [record.single, record.start, record.end].map((reading) => `${reading?.upload?.id}:${reading?.upload?.modelId}:${reading?.upload?.status}`)).sort().join('|');
      const tagsChanged = tags(records) !== tags(this.records());
      const wasActive = this.activeValidations() > 0; this.records.set(records);
      if (tagsChanged || (wasActive && this.activeValidations() === 0)) this.refresh(true);
    });
  }
  private refreshOcrFailures() {
    this.api.ocrFailures().subscribe({ next: (items) => this.ocrFailures.set(items), error: (error: HttpErrorResponse) => { if (error.status === 401) this.logout(); } });
  }
  retryFailedOcr() {
    if (this.retryOcrBusy() || this.resetOcrBusy() || this.failureModelSaving()) return;
    this.retryOcrBusy.set(true); this.error.set(''); this.message.set('');
    this.api.retryOcrFailures().subscribe({ next: (result) => {
      this.retryOcrBusy.set(false);
      this.message.set(result.busy ? 'Un nuovo tentativo è già in preparazione.'
        : `${result.queued} tentativi OCR accodati. ${result.skipped ? `${result.skipped} già in corso. ` : ''}${result.issues.length ? `${result.issues.length} non accodabili: consulta Debug.` : 'Gli alert si chiuderanno dopo la convalida.'}`);
      this.refresh(true);
    }, error: (error: HttpErrorResponse) => { this.retryOcrBusy.set(false); this.error.set('Impossibile riavviare gli OCR. Riprova.'); if (error.status === 401) this.logout(); } });
  }
  resetFailedOcr() {
    if (this.resetOcrBusy() || this.retryOcrBusy() || this.failureModelSaving() || !this.ocrFailures().length) return;
    if (!window.confirm(`Eliminare definitivamente i tentativi OCR falliti (${this.ocrFailures().length} alert)? Foto problematiche, notifiche e log saranno cancellati. Le ultime letture valide saranno conservate.`)) return;
    this.resetOcrBusy.set(true); this.clearFeedback();
    this.api.resetOcrFailures().subscribe({ next: (result) => {
      this.resetOcrBusy.set(false); this.debugConsoleOpen.set(false);
      this.releaseAllRecordImages();
      this.succeed(`Reset completato: ${result.notifications} alert e ${result.images} file eliminati. ${result.preservedReadings} letture valide conservate.`);
      this.refresh(true);
    }, error: (error: HttpErrorResponse) => { this.resetOcrBusy.set(false); this.fail(error); } });
  }
  setFailureModel(id: string, modelId: string) {
    this.failureModelDrafts.update((drafts) => ({ ...drafts, [id]: modelId }));
  }
  saveFailureModel(notification: OcrFailureNotification) {
    const modelId = this.failureModelDrafts()[notification.id] ?? notification.modelChoice?.modelId;
    if (!modelId || this.failureModelSaving() || this.retryOcrBusy() || this.resetOcrBusy()) return;
    this.failureModelSaving.set(notification.id); this.clearFeedback();
    this.api.saveFailureModelChoice(notification.id, modelId).subscribe({ next: () => {
      this.failureModelSaving.set(null); this.refreshOcrFailures();
      this.succeed('Scelta del modello salvata per entrambe le immagini. Premi Riprova per rieseguire i controlli OCR.');
    }, error: (error: HttpErrorResponse) => { this.failureModelSaving.set(null); this.fail(error); } });
  }
  private applyDefaults(projects: Project[], models: AiModel[]) {
    const selectedProject = this.recordForm.controls.projectId.value;
    const projectId = projects.some((project) => project.id === selectedProject) ? selectedProject : projects[0]?.id || '';
    this.recordForm.patchValue({ projectId });
    this.inboxProjectId.set(projectId);
    const recordProjectIds = new Set(this.recordProjects().map((project) => project.id));
    if (!recordProjectIds.has(this.recordsProjectId())) this.selectRecordsProject(this.recordProjects()[0]?.id || '');
    if (this.explorationEnabled() && !models.some((model) => model.id === this.costModelId())) {
      this.costModelId.set(models.find((item) => item.isDefault)?.id || models[0]?.id || '');
    }
  }
  modelLabel(modelId: string | null | undefined) {
    const model = this.models().find((item) => item.id === modelId);
    return model ? `${model.provider} · ${model.name} · ${this.reasoningLabel(model.reasoning)}` : modelId ? 'Modello non disponibile nel CSV' : 'Modello da riconoscere';
  }
  reasoningLabel(reasoning: string | null | undefined) {
    const { base, fast } = variantOrder(reasoning ?? '');
    const label = ({ light: 'Light', medium: 'Medium', high: 'High', xhigh: 'XHigh', ultra: 'Ultra' } as Record<string, string>)[base] ?? base;
    return label + (fast ? ' · Fast' : '');
  }
  toggleModelGroup(key: string) {
    this.expandedModelGroups.update((expanded) => {
      const next = new Set(expanded);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  modelWindowDuration(model: AiModel) {
    const minutes = model.pricing.maxTimeWindowMinutes ?? model.pricing.fiveHourWindowCost / model.pricing.costPerMinute;
    const seconds = Math.round(minutes * 60);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  private defaultModelId(models = this.models()) {
    return models.find((item) => item.isDefault)?.id || models[0]?.id || '';
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
