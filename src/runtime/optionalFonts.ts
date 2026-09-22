/** Decorative fonts may arrive later; they must never hold up view scripts. */
export function ensureOptionalFonts(doc: Document = document): void {
  if (!doc.head || doc.getElementById('mwg-optional-fonts')) return;
  const link = doc.createElement('link');
  link.id = 'mwg-optional-fonts';
  link.rel = 'stylesheet';
  link.media = 'print';
  link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;600;700&family=ZCOOL+KuaiLe&display=swap';
  link.onload = () => { link.media = 'all'; };
  doc.head.appendChild(link);
}
