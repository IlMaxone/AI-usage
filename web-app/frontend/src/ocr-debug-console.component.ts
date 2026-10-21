import { AfterViewInit, Component, ElementRef, EventEmitter, OnDestroy, Output, ViewChild, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ApiService } from './services';
import { OcrDebugReport } from './types';

@Component({
  selector: 'app-ocr-debug-console', standalone: true,
  template: `
    <dialog #consoleDialog aria-labelledby="debug-title" (cancel)="cancel($event)" (click)="backdrop($event)">
      <header><div><h2 id="debug-title">Debug OCR</h2><p>Console diagnostica · sola lettura</p></div>
        <div class="actions"><button type="button" (click)="load()" [disabled]="loading()">Aggiorna log</button>
          <button class="download" type="button" (click)="download()" [disabled]="loading() || !report()">Download error_logs</button>
          <button type="button" (click)="closed.emit()" aria-label="Chiudi console debug">×</button></div>
      </header>
      <div class="console" tabindex="0" aria-label="Log degli errori OCR" [attr.aria-busy]="loading()">
        @if (loading()) { <p class="prompt">$ ai-usage debug --failed</p><p role="status">Caricamento dei log…</p> }
        @else if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        @else { <pre>{{ consoleText() }}</pre> }
      </div>
      <footer>Esporta prima l’elenco dei file non convalidati, poi i log per immagine. Nessun comando viene eseguito.</footer>
    </dialog>`,
  styles: [`
    dialog{width:min(1040px,calc(100vw - 32px));max-width:none;max-height:86dvh;padding:0;border:1px solid #3a444b;border-radius:12px;background:#090d10;color:#d7e4dc;box-shadow:0 25px 80px #0009}
    dialog::backdrop{background:#000a}header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;background:#171e23;border-bottom:1px solid #344047;flex-wrap:wrap}
    h2{font:600 17px system-ui;margin:0;color:#f4fbf6}header p{margin:5px 0 0;color:#a7b7ae;font:12px system-ui}.actions{display:flex;gap:8px;flex-wrap:wrap}button{border:1px solid #54635b;background:#202c25;color:#e3f3e9;padding:9px 12px;border-radius:6px;cursor:pointer;font:600 12px system-ui}.download{background:#c3eccb;color:#13251b}button:disabled{opacity:.45;cursor:wait}button:focus-visible,.console:focus-visible{outline:2px solid #a6eab7;outline-offset:2px}.console{padding:20px;overflow:auto;max-height:58dvh;font:12px/1.7 Consolas,monospace}pre{margin:0;white-space:pre;tab-size:2;font:inherit}.prompt{color:#a5edb4}.error{color:#ffaaa3}footer{padding:12px 20px;border-top:1px solid #344047;color:#9baba1;font:11px/1.5 system-ui}
  `],
})
export class OcrDebugConsoleComponent implements AfterViewInit, OnDestroy {
  @Output() closed = new EventEmitter<void>();
  @ViewChild('consoleDialog') dialog!: ElementRef<HTMLDialogElement>;
  private readonly api = inject(ApiService);
  private request?: Subscription;
  private readonly previousFocus = document.activeElement as HTMLElement | null;
  private urls: string[] = [];
  readonly report = signal<OcrDebugReport | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly consoleText = computed(() => {
    const report = this.report();
    if (!report) return '';
    const lines = ['$ ai-usage debug --failed', `# ${report.immagini_infette.length} immagini non convalidate`, ''];
    if (!report.logs_errori.length) lines.push('Nessun errore OCR da verificare.');
    for (const item of report.logs_errori) {
      lines.push(`>>> ${item.progetto} / ${item.immagine}`, `stato: ${item.stato}`, `motivo: ${item.motivo}`,
        `file: ${item.file_disponibile ? 'disponibile' : 'non disponibile'} · coppia: ${item.coppia ?? 'singola'}`, `cartella: ${item.cartella ?? 'non disponibile'}`);
      if (item.ultima_lettura_valida_conservata) lines.push('# L’ultima lettura valida è conservata in archivio; l’errore riguarda il nuovo tentativo.');
      for (const attempt of item.tentativi) {
        lines.push(`--- ${attempt.data} · ${attempt.ruolo} · ${attempt.stato}`, `sha256: ${attempt.sha256 ?? 'non calcolato'}`);
        for (const event of attempt.log) lines.push(`[${event.at}] [${event.level.toUpperCase()}] ${event.stage} / ${event.code} ${JSON.stringify(event.details)}`);
      }
      for (const event of item.log_storico) lines.push(`[${event.at}] [ERROR] ${event.code}: ${event.message}`, `# ${event.note}`);
      if (item.stato === 'PAIR_BLOCKED') lines.push('# Questa metà è bloccata dall’altra immagine: non è un errore OCR indipendente.');
      lines.push('');
    }
    lines.push('$ export error_logs.json', '# Esclusi testo OCR completo, contenuto delle conversazioni e credenziali.');
    return lines.join('\n');
  });
  ngAfterViewInit() { this.dialog.nativeElement.showModal(); this.load(); }
  ngOnDestroy() {
    this.request?.unsubscribe(); this.dialog.nativeElement.close(); this.previousFocus?.focus();
    for (const url of this.urls) URL.revokeObjectURL(url);
  }
  load() {
    this.request?.unsubscribe(); this.loading.set(true); this.error.set('');
    this.request = this.api.ocrDebug().subscribe({ next: (report) => { this.report.set(report); this.loading.set(false); },
      error: () => { this.report.set(null); this.loading.set(false); this.error.set('Impossibile caricare i log. Aggiorna per riprovare.'); } });
  }
  download() {
    const report = this.report(); if (!report || this.loading()) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json;charset=utf-8' }));
    this.urls.push(url);
    const link = document.createElement('a'); link.href = url; link.download = 'error_logs.json';
    document.body.appendChild(link); link.click(); link.remove();
  }
  cancel(event: Event) { event.preventDefault(); this.closed.emit(); }
  backdrop(event: MouseEvent) { if (event.target === this.dialog.nativeElement) {
    const rect = this.dialog.nativeElement.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.closed.emit();
  } }
}
