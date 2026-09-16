const root = document.body;
for (const button of document.querySelectorAll('[data-action="future-mode"]')) {
  button.addEventListener('click', () => {
    root.classList.toggle('future');
    const active = root.classList.contains('future');
    for (const item of document.querySelectorAll('[data-action="future-mode"]')) {
      item.textContent = active ? 'Normal Mode' : 'Future Mode';
    }
  });
}
