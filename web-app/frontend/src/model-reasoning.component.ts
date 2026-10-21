import { Component, Input } from '@angular/core';
import { variantOrder } from './model-groups';

@Component({
  selector: 'app-model-reasoning',
  standalone: true,
  template: `{{ label }} @if (fast) { <span class="fast-mode"><svg viewBox="0 0 16 18" aria-hidden="true" focusable="false"><path d="M9.5 1 1.5 10h5l-1 7 9-10h-5l1-6Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>Fast</span> }`,
  styles: [`:host{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}.fast-mode{display:inline-flex;align-items:center;gap:4px;padding:3px 6px;border-radius:5px;background:#59412f;color:#fff7e7;font-size:11px}svg{width:12px;height:14px;flex-shrink:0}`],
})
export class ModelReasoningComponent {
  @Input() reasoning: string | null | undefined;
  get fast() { return variantOrder(this.reasoning ?? '').fast; }
  get label() {
    const { base } = variantOrder(this.reasoning ?? '');
    return ({ light: 'Light', medium: 'Medium', high: 'High', xhigh: 'XHigh', ultra: 'Ultra' } as Record<string, string>)[base] ?? base;
  }
}
