/** Fixture: menu code with deliberate rule violations. */
export function render(el: { textContent: string }): void {
  el.textContent = 'Play now';
  label('Win streak');
  const ok = 'Ignored text'; // i18n-ok
  const k = t('menu.missingKey');
  console.log('debug', k, ok);
  const r = Math.random();
  const ignored = 'Also ignored'; // i18n-ok
  return void (r + ignored);
}

export function label(s: string): string {
  return s;
}

declare function t(key: string): string;
