// Read the code's text nodes so blank lines and indentation survive copying.
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.hextra-code-copy-btn').forEach(button => {
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const codes = button.closest('.hextra-code-block').querySelectorAll('pre code');
      const code = codes[codes.length - 1];
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code.textContent);
        const label = button.getAttribute('aria-label');
        button.classList.add('copied');
        button.setAttribute('aria-label', button.dataset.copiedLabel || 'Copied!');
        setTimeout(() => {
          button.classList.remove('copied');
          button.setAttribute('aria-label', label);
        }, 1000);
      } catch (error) {
        console.error('Could not copy code', error);
      }
    }, { capture: true });
  });
});
