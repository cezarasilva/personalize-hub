/**
 * PERSONALIZE HUB — Theme v6.1
 * Aplica data-theme imediatamente (sem flash).
 * Injeta botão flutuante SOMENTE em páginas sem sidebar
 * (catálogo público, login, etc.) — nas demais o painel de
 * configurações da sidebar controla o tema.
 */
(function () {
  const KEY = 'ph-theme';
  const saved = localStorage.getItem(KEY) || 'light';
  document.documentElement.setAttribute('data-theme', saved);

  document.addEventListener('DOMContentLoaded', function () {
    // Páginas com sidebar têm o tema gerenciado pelo painel de configurações
    if (document.querySelector('#sidebar')) return;

    const current = document.documentElement.getAttribute('data-theme');
    const btn = document.createElement('button');
    btn.className = 'theme-toggle-btn theme-toggle-fixed';
    btn.setAttribute('aria-label', 'Alternar tema');
    btn.innerHTML = current === 'dark'
      ? '<i class="bx bx-sun"></i> Light'
      : '<i class="bx bx-moon"></i> Dark';

    btn.addEventListener('click', function () {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(KEY, next);
      btn.innerHTML = next === 'dark'
        ? '<i class="bx bx-sun"></i> Light'
        : '<i class="bx bx-moon"></i> Dark';
    });

    document.body.appendChild(btn);
  });
})();
