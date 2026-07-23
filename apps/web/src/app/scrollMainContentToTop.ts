export function scrollMainContentToTop(): void {
  document.querySelector<HTMLElement>('.product-main')?.scrollTo({ top: 0, behavior: 'auto' });
}
