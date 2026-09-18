import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin, map, of, switchMap, tap } from 'rxjs';
import { ApiService, AuthService } from './services';
import { AiModel, CostAnalysis, Dashboard, GalleryUpload, Project, Reading, UsageRecord } from './types';

type Tab = 'overview' | 'projects' | 'insert' | 'records' | 'analysis' | 'models';
type AnalysisImage = GalleryUpload & { url: string };
const localizedDecimalPattern = /^(?:0|[1-9]\d*)(?:[.,]\d+)?$/;

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
  readonly costModelId = signal('');
  readonly costProjectId = signal('');
  readonly editingProjectId = signal<string | null>(null);
  readonly editingModelId = signal<string | null>(null);
  readonly correctionTarget = signal<{ recordId: string; uploadId: string; label: string } | null>(null);
  readonly selectedFiles = signal<Record<'single' | 'start' | 'end', { name: string; size: string } | null>>({ single: null, start: null, end: null });
  readonly uploadFeedback = signal('');
  readonly analysisImages = signal<AnalysisImage[]>([]);
  readonly analysisLoading = signal(false);
  readonly analysisProjectId = signal('');
  readonly selectedAnalysisImage = signal<AnalysisImage | null>(null);
  readonly visibleAnalysisImages = computed(() => this.analysisImages());
  readonly activeValidations = computed(() => this.records().filter((item) => item.status === 'VALIDATING').length);
  private singleFile: File | null = null;
  private startFile: File | null = null;
  private endFile: File | null = null;
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
    if (tab === 'analysis') {
      this.analysisProjectId.set(this.analysisProjectId() || this.projects()[0]?.id || '');
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
    this.projects.set([]); this.records.set([]); this.models.set([]); this.costAnalysis.set(null);
  }
  refresh(preserveFeedback = false) {
    this.loading.set(true); if (!preserveFeedback) this.clearFeedback();
    forkJoin({ dashboard: this.api.dashboard(), projects: this.api.projects(), records: this.api.records(), models: this.api.models() }).subscribe({
      next: ({ dashboard, projects, records, models }) => {
        this.dashboard.set(dashboard); this.projects.set(projects); this.records.set(records); this.models.set(models);
        this.applyDefaults(projects, models); this.loading.set(false);
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

  chooseFile(slot: 'single' | 'start' | 'end', event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    if (file && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      this.error.set('Formato non supportato: usa PNG, JPEG o WebP.');
      (event.target as HTMLInputElement).value = '';
      return;
    }
    if (file && file.size > 10_485_760) {
      this.error.set('L’immagine supera il limite di 10 MB.');
      (event.target as HTMLInputElement).value = '';
      return;
    }
    if (slot === 'single') this.singleFile = file;
    else if (slot === 'start') this.startFile = file;
    else this.endFile = file;
    this.selectedFiles.update((current) => ({
      ...current,
      [slot]: file ? { name: file.name, size: `${(file.size / 1_048_576).toFixed(2)} MB` } : null,
    }));
    this.uploadFeedback.set(file ? `Immagine selezionata: ${file.name}` : '');
    this.error.set('');
  }
  startValidation() {
    if (this.recordForm.invalid) return;
    const value = this.recordForm.getRawValue();
    if (value.mode === 'CONSTANT' && !this.singleFile) { this.error.set('Seleziona lo screenshot della rilevazione.'); return; }
    if (value.mode === 'SEGMENT' && (!this.startFile || !this.endFile)) { this.error.set('Seleziona sia lo screenshot iniziale sia quello finale.'); return; }
    const body = new FormData();
    body.append('projectId', value.projectId); body.append('mode', value.mode);
    if (value.note) body.append('note', value.note);
    if (value.mode === 'CONSTANT') body.append('single', this.singleFile!);
    else { body.append('start', this.startFile!); body.append('end', this.endFile!); }
    this.loading.set(true); this.clearFeedback();
    this.uploadFeedback.set(value.mode === 'CONSTANT' ? 'Caricamento dello screenshot…' : 'Caricamento dei due screenshot…');
    this.api.createRecord(body).pipe(
      tap(() => this.uploadFeedback.set(value.mode === 'CONSTANT'
        ? 'Screenshot caricato. Avvio della tripla verifica OCR…'
        : 'Due screenshot caricati. Avvio della tripla verifica OCR…')),
      switchMap((record) => this.api.validateRecord(record.id)),
    ).subscribe({
      next: () => {
        this.loading.set(false); this.singleFile = null; this.startFile = null; this.endFile = null;
        this.selectedFiles.set({ single: null, start: null, end: null });
        this.uploadFeedback.set('Screenshot ricevuto e tripla verifica OCR avviata.');
        this.recordForm.controls.note.setValue(''); this.succeed('Screenshot caricato correttamente. La tripla verifica OCR è in corso.');
        this.tab.set('records'); this.refresh(true);
      },
      error: (error) => { this.uploadFeedback.set(''); this.fail(error); },
    });
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
    this.costModelId.set(modelId); this.loadCostAnalysis();
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
    this.analysisProjectId.set(projectId); this.loadAnalysisImages();
  }
  private releaseAnalysisImages() {
    for (const item of this.analysisImages()) URL.revokeObjectURL(item.url);
    this.analysisImages.set([]); this.selectedAnalysisImage.set(null);
  }
  tabTitle() {
    return ({
      overview: 'La scrivania', projects: 'I progetti', insert: 'Nuova lettura', records: 'Archivio usage',
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
