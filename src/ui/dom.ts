/** Minimal DOM helpers: build from a template and collect `data-ref` elements. */
export function fromTemplate<T extends string>(html: string): { root: HTMLElement; refs: Record<T, HTMLElement> } {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  const root = template.content.firstElementChild as HTMLElement;
  const refs = {} as Record<T, HTMLElement>;
  root.querySelectorAll<HTMLElement>('[data-ref]').forEach((el) => {
    refs[el.dataset.ref as T] = el;
  });
  return { root, refs };
}

/** Set text only when it changed (avoids needless layout work at 60 fps). */
export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
