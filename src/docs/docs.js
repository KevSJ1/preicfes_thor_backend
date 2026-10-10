// Ajusta los ejemplos a la URL desde la que se abre la documentación y filtra endpoints con el buscador.
document.querySelectorAll('.base-url').forEach((node) => { node.textContent = window.location.origin; });

const search = document.getElementById('search');
const sections = [...document.querySelectorAll('section.ref')];
const guide = [...document.querySelectorAll('main > section:not(.ref)')];
const noResults = document.getElementById('no-results');

search.addEventListener('input', () => {
  const term = search.value.trim().toLowerCase();
  let visible = 0;
  guide.forEach((section) => section.classList.toggle('hidden', Boolean(term)));
  sections.forEach((section) => {
    let count = 0;
    section.querySelectorAll('.ep').forEach((endpoint) => {
      const match = !term || endpoint.textContent.toLowerCase().includes(term);
      endpoint.classList.toggle('hidden', !match);
      if (match) count += 1;
    });
    section.classList.toggle('hidden', count === 0);
    visible += count;
  });
  noResults.classList.toggle('hidden', visible > 0);
});
