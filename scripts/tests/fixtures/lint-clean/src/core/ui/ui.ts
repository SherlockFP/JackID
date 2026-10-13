/** Fixture: DOM is allowed in core/ui; the text is supplied by the caller. */
export function badge(text: string): HTMLElement {
  const el = document.createElement('div');
  el.textContent = text;
  el.className = 'badge primary';
  return el;
}
