/**
 * PERSONALIZE HUB — Theme Toggle v6.0
 * Aplica Light Pro / Dark Premium via data-theme no <html>
 * Persiste no localStorage. Injeta botão de alternância automaticamente.
 */
(function () {
  const KEY = 'ph-theme';
  const saved = localStorage.getItem(KEY) || 'light';

  // Aplica o tema imediatamente para evitar flash
  document.documentElement.setAttribute('data-theme', saved);

  function getIcon(theme) {
    return theme === 'dark'
      ? '<i class="bx bx-sun"></i> Light'
      : '<i class="bx bx-moon"></i> Dark';
  }

  document.addEventListener('DOMContentLoaded', function () {
    const current = document.documentElement.getAttribute('data-theme');

    const btn = document.createElement('button');
    btn.className = 'theme-toggle-btn';
    btn.setAttribute('aria-label', 'Alternar tema');
    btn.innerHTML = getIcon(current);

    btn.addEventListener('click', function () {
      const now = document.documentElement.getAttribute('data-theme');
      const next = now === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(KEY, next);
      btn.innerHTML = getIcon(next);
    });

    // Se tiver sidebar, injeta no final dela
    const sidebarLinks = document.querySelector('.sidebar-links');
    if (sidebarLinks) {
      const wrapper = document.createElement('div');
      wrapper.className = 'theme-toggle-sidebar';
      wrapper.appendChild(btn);
      sidebarLinks.appendChild(wrapper);
      return;
    }

    // Fallback: botão flutuante fixo (catálogo público, auth, etc.)
    btn.classList.add('theme-toggle-fixed');
    document.body.appendChild(btn);
  });
})();
