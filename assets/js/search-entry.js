function initSearchEntry() {
  // Theme listeners register during DOMContentLoaded; click after they finish.
  requestAnimationFrame(() => {
    document.querySelector('main [data-search-open]')?.click();
  });
}

if (document.readyState !== 'complete') {
  document.addEventListener('DOMContentLoaded', initSearchEntry, { once: true });
} else {
  initSearchEntry();
}
