import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService, AuthService } from './services';
import { AiModel, Dashboard, Project, Upload, UsageEvent } from './types';

type Tab = 'overview' | 'events' | 'upload' | 'models';

function localDateTime(offsetMinutes = 0) {
  const date = new Date(Date.now() + offsetMinutes * 60_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
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
  readonly events = signal<UsageEvent[]>([]);
  readonly models = signal<AiModel[]>([]);
  readonly uploads = signal<Upload[]>([]);
  readonly activeUploads = computed(() => this.uploads().filter((item) => ['UPLOADED', 'PROCESSING'].includes(item.status)).length);
  private selectedFile: File | null = null;
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

  readonly eventForm = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: Validators.required }),
    projectId: new FormControl('', { nonNullable: true, validators: Validators.required }),
    modelId: new FormControl('', { nonNullable: true, validators: Validators.required }),
    startsAt: new FormControl(localDateTime(), { nonNullable: true, validators: Validators.required }),
    endsAt: new FormControl('', { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true }),
  });

  readonly uploadForm = new FormGroup({
    projectId: new FormControl('', { nonNullable: true, validators: Validators.required }),
    eventId: new FormControl('', { nonNullable: true }),
    role: new FormControl<'SINGLE' | 'START' | 'END'>('SINGLE', { nonNullable: true }),
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
    expression: new FormControl(
      '{\n  "operation": "multiply",\n  "args": [\n    { "operation": "divide", "args": [{ "variable": "usedPct" }, 100] },\n    { "variable": "fullWindowCredits" }\n  ]\n}',
      { nonNullable: true, validators: Validators.required },
    ),
  });

  readonly creditsForm = new FormGroup({
    credits: new FormControl(0, { nonNullable: true, validators: Validators.min(1) }),
    paidEur: new FormControl(0, { nonNullable: true, validators: Validators.min(0.01) }),
    purchasedAt: new FormControl(localDateTime(), { nonNullable: true, validators: Validators.required }),
  });

  constructor() {
    if (this.auth.user()) this.refresh();
    this.poller = setInterval(() => {
      if (this.auth.user() && this.activeUploads() > 0) this.refreshUploads();
    }, 4000);
  }

  ngOnDestroy() { clearInterval(this.poller); }

  setTab(tab: Tab) { this.tab.set(tab); this.clearFeedback(); }

  submitAuth() {
    if (this.authForm.invalid) return;
    this.loading.set(true); this.clearFeedback();
    const { email, password, displayName } = this.authForm.getRawValue();
    const request = this.registerMode()
      ? this.auth.register(email, password, displayName)
      : this.auth.login(email, password);
    request.subscribe({
      next: () => { this.loading.set(false); this.refresh(); },
      error: (error: HttpErrorResponse) => this.fail(error),
    });
  }

  logout() {
    this.auth.logout();
    this.dashboard.set(null); this.projects.set([]); this.events.set([]); this.models.set([]); this.uploads.set([]);
  }

  refresh() {
    this.loading.set(true); this.clearFeedback();
    forkJoin({ dashboard: this.api.dashboard(), projects: this.api.projects(), events: this.api.events(), models: this.api.models(), uploads: this.api.uploads() })
      .subscribe({
        next: ({ dashboard, projects, events, models, uploads }) => {
          this.dashboard.set(dashboard); this.projects.set(projects); this.events.set(events); this.models.set(models); this.uploads.set(uploads);
          this.applyDefaults(projects, models); this.loading.set(false);
        },
        error: (error: HttpErrorResponse) => this.fail(error),
      });
  }

  createProject() {
    if (this.projectForm.invalid) return;
    this.api.createProject(this.projectForm.getRawValue()).subscribe({
      next: () => { this.projectForm.controls.name.setValue(''); this.succeed('Progetto creato.'); this.refresh(); },
      error: (error: HttpErrorResponse) => this.fail(error),
    });
  }

  createEvent() {
    if (this.eventForm.invalid) return;
    const value = this.eventForm.getRawValue();
    this.api.createEvent({
      ...value,
      startsAt: new Date(value.startsAt).toISOString(),
      endsAt: value.endsAt ? new Date(value.endsAt).toISOString() : undefined,
      notes: value.notes || undefined,
    }).subscribe({
      next: () => {
        this.eventForm.patchValue({ title: '', startsAt: localDateTime(), endsAt: '', notes: '' });
        this.succeed('Evento aggiunto. Ora puoi collegare gli screenshot.'); this.refresh();
      },
      error: (error: HttpErrorResponse) => this.fail(error),
    });
  }

  deleteEvent(id: string) {
    if (!window.confirm('Eliminare l’evento dalla vista? La traccia audit resterà conservata.')) return;
    this.api.deleteEvent(id).subscribe({
      next: () => { this.succeed('Evento rimosso dalla vista e conservato nell’audit.'); this.refresh(); },
      error: (error: HttpErrorResponse) => this.fail(error),
    });
  }

  chooseFile(event: Event) {
    this.selectedFile = (event.target as HTMLInputElement).files?.[0] ?? null;
  }

  upload() {
    if (this.uploadForm.invalid || !this.selectedFile) { this.error.set('Seleziona un’immagine e completa i campi.'); return; }
    const value = this.uploadForm.getRawValue();
    if (value.role !== 'SINGLE' && !value.eventId) { this.error.set('Per inizio/fine devi selezionare un evento.'); return; }
    const body = new FormData();
    body.append('file', this.selectedFile);
    body.append('projectId', value.projectId);
    body.append('role', value.role);
    if (value.eventId) body.append('eventId', value.eventId);
    this.loading.set(true); this.clearFeedback();
    this.api.upload(body).subscribe({
      next: () => { this.loading.set(false); this.selectedFile = null; this.succeed('Upload ricevuto: il doppio controllo OCR è in coda.'); this.refresh(); },
      error: (error: HttpErrorResponse) => this.fail(error),
    });
  }

  createModel() {
    if (this.modelForm.invalid) return;
    const value = this.modelForm.getRawValue();
    this.api.createModel({
      provider: value.provider, name: value.name, reasoning: value.reasoning,
      pricing: { currency: value.currency, inputPerMillion: Number(value.input), cachedInputPerMillion: Number(value.cached), outputPerMillion: Number(value.output) },
    }).subscribe({
      next: () => { this.modelForm.controls.name.setValue(''); this.succeed('Modello creato.'); this.refresh(); },
      error: (error: HttpErrorResponse) => this.fail(error),
    });
  }

  addCalibration() {
    if (this.calibrationForm.invalid) return;
    const value = this.calibrationForm.getRawValue();
    this.api.addCalibration(value.modelId, {
      observedUsagePct: Number(value.observedUsagePct),
      observedDurationSeconds: Number(value.observedDurationSeconds),
      estimatedBilledEur: Number(value.estimatedBilledEur),
      creditPackCredits: Number(value.creditPackCredits),
      creditPackPaidEur: Number(value.creditPackPaidEur),
      pilotReasoning: value.pilotReasoning,
      pilotExecutionMode: value.pilotExecutionMode,
      pilotDurationSeconds: Number(value.pilotDurationSeconds),
      pilotBilledEur: Number(value.pilotBilledEur),
      note: value.note || undefined,
    }).subscribe({
      next: () => { this.succeed('Osservazione append-only registrata; i risultati sono stati derivati dal motore.'); this.refresh(); },
      error: (error: HttpErrorResponse) => this.fail(error),
    });
  }

  createRule() {
    if (this.ruleForm.invalid) return;
    const value = this.ruleForm.getRawValue();
    let expression: unknown;
    try { expression = JSON.parse(value.expression); }
    catch { this.error.set('Il calcolo non è JSON valido.'); return; }
    this.api.createRule(value.modelId, { name: value.name, outputUnit: value.outputUnit, expression, isDefault: true }).subscribe({
      next: () => { this.succeed('Calcolo aggiunto e versionabile.'); this.refresh(); },
      error: (error: HttpErrorResponse) => this.fail(error),
    });
  }

  addCredits() {
    if (this.creditsForm.invalid) return;
    const value = this.creditsForm.getRawValue();
    this.api.addCredits({ credits: Number(value.credits), paidEur: Number(value.paidEur), purchasedAt: new Date(value.purchasedAt).toISOString() }).subscribe({
      next: () => { this.succeed('Acquisto registrato come interamente speso, residuo zero.'); this.refresh(); },
      error: (error: HttpErrorResponse) => this.fail(error),
    });
  }

  statusLabel(status: string) {
    return ({ PAIRED: 'Delta verificato', END_ONLY: 'Solo finale', WAITING_FOR_END: 'Attende fine', WINDOW_MISMATCH: 'Reset diverso', NO_USAGE: 'Senza usage' } as Record<string, string>)[status] ?? status;
  }

  uploadStatus(status: string) {
    return ({ UPLOADED: 'In coda', PROCESSING: 'OCR in corso', VALIDATED: 'Validato', MANUAL_REVIEW: 'Verifica manuale', FAILED: 'Errore' } as Record<string, string>)[status] ?? status;
  }

  private refreshUploads() {
    this.api.uploads().subscribe((uploads) => {
      const hadActive = this.activeUploads() > 0;
      this.uploads.set(uploads);
      if (hadActive && this.activeUploads() === 0) this.refresh();
    });
  }

  private applyDefaults(projects: Project[], models: AiModel[]) {
    const projectId = this.eventForm.controls.projectId.value || projects[0]?.id || '';
    const modelId = this.eventForm.controls.modelId.value || models.find((item) => item.isDefault)?.id || models[0]?.id || '';
    this.eventForm.patchValue({ projectId, modelId });
    this.uploadForm.controls.projectId.setValue(this.uploadForm.controls.projectId.value || projectId);
    this.ruleForm.controls.modelId.setValue(this.ruleForm.controls.modelId.value || modelId);
    this.calibrationForm.controls.modelId.setValue(this.calibrationForm.controls.modelId.value || modelId);
  }

  private clearFeedback() { this.message.set(''); this.error.set(''); }
  private succeed(message: string) { this.error.set(''); this.message.set(message); }
  private fail(error: HttpErrorResponse) {
    this.loading.set(false);
    const message = Array.isArray(error.error?.message) ? error.error.message.join(' · ') : error.error?.message;
    this.error.set(message || 'Operazione non riuscita. Riprova.');
    if (error.status === 401) this.logout();
  }
}
