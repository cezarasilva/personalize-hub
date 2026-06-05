/**
 * PERSONALIZE HUB — Theme + Auth Guard v6.2
 * 1. Aplica data-theme imediatamente (sem flash).
 * 2. Redireciona para login se não houver token em páginas protegidas.
 */
(function () {
  // ---- Auth guard síncrono: evita qualquer flash de conteúdo ----
  const PUBLIC_PAGES = [
    'index.html', '', 'recuperar.html', 'registrar.html',
    'redefinir-senha.html', 'catalogo-publico.html', 'catalogo.html'
  ];
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  if (!PUBLIC_PAGES.includes(currentPage) && !localStorage.getItem('token_personalize')) {
    location.replace('index.html');
  }

  // ---- Tema ----
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
