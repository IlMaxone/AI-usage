import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin, switchMap, tap } from 'rxjs';
import { ApiService, AuthService } from './services';
import { AiModel, Dashboard, Project, Reading, UsageRecord } from './types';

type Tab = 'overview' | 'projects' | 'insert' | 'records' | 'models';

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
  readonly editingProjectId = signal<string | null>(null);
  readonly correctionTarget = signal<{ recordId: string; uploadId: string; label: string } | null>(null);
  readonly selectedFiles = signal<Record<'single' | 'start' | 'end', { name: string; size: string } | null>>({ single: null, start: null, end: null });
  readonly uploadFeedback = signal('');
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
    modelId: new FormControl('', { nonNullable: true, validators: Validators.required }),
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
    input: new FormControl(0, { nonNullable: true, validators: Validators.min(0) }),
    cached: new FormControl(0, { nonNullable: true, validators: Validators.min(0) }),
    output: new FormControl(0, { nonNullable: true, validators: Validators.min(0) }),
  });
  readonly calibrationForm = new FormGroup({
    modelId: new FormControl('', { nonNullable: true, validators: Validators.required }),
    observedUsagePct: new FormControl(50, { nonNullable: true, validators: [Validators.min(.01), Validators.max(100)] }),
    observedDurationSeconds: new FormControl(3000, { nonNullable: true, validators: Validators.min(1) }),
    estimatedBilledEur: new FormControl(0, { nonNullable: true, validators: Validators.min(.0001) }),
    creditPackCredits: new FormControl(0, { nonNullable: true, validators: Validators.min(1) }),
    creditPackPaidEur: new FormControl(0, { nonNullable: true, validators: Validators.min(.01) }),
    pilotReasoning: new FormControl('high', { nonNullable: true, validators: Validators.required }),
    pilotExecutionMode: new FormControl('standard', { nonNullable: true, validators: Validators.required }),
    pilotDurationSeconds: new FormControl(600, { nonNullable: true, validators: Validators.min(1) }),
    pilotBilledEur: new FormControl(0, { nonNullable: true, validators: Validators.min(.0001) }),
    note: new FormControl('', { nonNullable: true }),
  });
  readonly ruleForm = new FormGroup({
    modelId: new FormControl('', { nonNullable: true, validators: Validators.required }),
    name: new FormControl('Crediti per utilizzo', { nonNullable: true, validators: Validators.required }),
    outputUnit: new FormControl('crediti', { nonNullable: true, validators: Validators.required }),
    expression: new FormControl('{\n  "operation": "multiply",\n  "args": [\n    { "operation": "divide", "args": [{ "variable": "usedPct" }, 100] },\n    { "variable": "fullWindowCredits" }\n  ]\n}', { nonNullable: true, validators: Validators.required }),
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
  ngOnDestroy() { clearInterval(this.poller); }
  setTab(tab: Tab) { this.tab.set(tab); this.clearFeedback(); }

  submitAuth() {
    if (this.authForm.invalid) return;
    this.loading.set(true); this.clearFeedback();
    const { email, password, displayName } = this.authForm.getRawValue();
    const request = this.registerMode() ? this.auth.register(email, password, displayName) : this.auth.login(email, password);
    request.subscribe({ next: () => { this.loading.set(false); this.refresh(); }, error: (error) => this.fail(error) });
  }
  logout() { this.auth.logout(); this.dashboard.set(null); this.projects.set([]); this.records.set([]); this.models.set([]); }
  refresh(preserveFeedback = false) {
    this.loading.set(true); if (!preserveFeedback) this.clearFeedback();
    forkJoin({ dashboard: this.api.dashboard(), projects: this.api.projects(), records: this.api.records(), models: this.api.models() }).subscribe({
      next: ({ dashboard, projects, records, models }) => {
        this.dashboard.set(dashboard); this.projects.set(projects); this.records.set(records); this.models.set(models);
        this.applyDefaults(projects, models); this.loading.set(false);
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
    body.append('projectId', value.projectId); body.append('modelId', value.modelId); body.append('mode', value.mode);
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
    this.api.createModel({ provider: value.provider, name: value.name, reasoning: value.reasoning, pricing: {
      currency: value.currency, inputPerMillion: Number(value.input), cachedInputPerMillion: Number(value.cached), outputPerMillion: Number(value.output),
    } }).subscribe({ next: () => { this.modelForm.controls.name.setValue(''); this.succeed('Modello creato.'); this.refresh(true); }, error: (error) => this.fail(error) });
  }
  addCalibration() {
    if (this.calibrationForm.invalid) return;
    const value = this.calibrationForm.getRawValue();
    this.api.addCalibration(value.modelId, {
      observedUsagePct: Number(value.observedUsagePct), observedDurationSeconds: Number(value.observedDurationSeconds),
      estimatedBilledEur: Number(value.estimatedBilledEur), creditPackCredits: Number(value.creditPackCredits),
      creditPackPaidEur: Number(value.creditPackPaidEur), pilotReasoning: value.pilotReasoning,
      pilotExecutionMode: value.pilotExecutionMode, pilotDurationSeconds: Number(value.pilotDurationSeconds),
      pilotBilledEur: Number(value.pilotBilledEur), note: value.note || undefined,
    }).subscribe({ next: () => { this.succeed('Osservazione append-only registrata.'); this.refresh(true); }, error: (error) => this.fail(error) });
  }
  createRule() {
    if (this.ruleForm.invalid) return;
    const value = this.ruleForm.getRawValue(); let expression: unknown;
    try { expression = JSON.parse(value.expression); } catch { this.error.set('Il calcolo non è JSON valido.'); return; }
    this.api.createRule(value.modelId, { name: value.name, outputUnit: value.outputUnit, expression, isDefault: true }).subscribe({
      next: () => { this.succeed('Calcolo aggiunto.'); this.refresh(true); }, error: (error) => this.fail(error),
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
  readings(record: UsageRecord) {
    return record.mode === 'CONSTANT'
      ? [{ value: record.single, label: 'Screenshot usage' }]
      : [{ value: record.start, label: 'Screenshot iniziale' }, { value: record.end, label: 'Screenshot finale' }];
  }
  private refreshRecords() {
    this.api.records().subscribe((records) => {
      const wasActive = this.activeValidations() > 0; this.records.set(records);
      if (wasActive && this.activeValidations() === 0) this.refresh();
    });
  }
  private applyDefaults(projects: Project[], models: AiModel[]) {
    const projectId = this.recordForm.controls.projectId.value || projects[0]?.id || '';
    const modelId = this.recordForm.controls.modelId.value || models.find((item) => item.isDefault)?.id || models[0]?.id || '';
    this.recordForm.patchValue({ projectId, modelId });
    this.ruleForm.controls.modelId.setValue(this.ruleForm.controls.modelId.value || modelId);
    this.calibrationForm.controls.modelId.setValue(this.calibrationForm.controls.modelId.value || modelId);
  }
  private clearFeedback() { this.message.set(''); this.error.set(''); }
  private succeed(message: string) { this.error.set(''); this.message.set(message); }
  private fail(error: HttpErrorResponse) {
    this.loading.set(false);
    const message = Array.isArray(error.error?.message) ? error.error.message.join(' · ') : error.error?.message;
    this.error.set(message || 'Operazione non riuscita. Riprova.'); if (error.status === 401) this.logout();
  }
}
