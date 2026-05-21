window.App = (() => {
    const API_BASE = '/api';
    const TOKEN_KEY = 'token_personalize';
    const USER_KEY = 'usuario_personalize';

    function token() { return localStorage.getItem(TOKEN_KEY); }
    function user() { try { return JSON.parse(localStorage.getItem(USER_KEY) || '{}'); } catch { return {}; } }
    function isAdmin() { return user().perfil === 'ADMIN'; }
    function isParceiro() { return user().perfil === 'PARCEIRO'; }

    function setUser(dados) {
        localStorage.setItem(TOKEN_KEY, dados.token);
        localStorage.setItem(USER_KEY, JSON.stringify(dados.usuario || {}));
        localStorage.setItem('nome_usuario', dados.usuario?.nome || '');
        localStorage.setItem('perfil_usuario', dados.usuario?.perfil || '');
        localStorage.setItem('parceiro_id', dados.usuario?.parceiro_id || '');
    }

    function logout() {
        localStorage.clear();
        window.location.href = 'index.html';
    }

    function requireAuth() {
        if (!token()) window.location.href = 'index.html';
    }

    function requireAdmin() {
        requireAuth();
        if (!isAdmin()) window.location.href = 'minha-loja.html';
    }

    function protectPage({ adminOnly = false, parceiroOnly = false } = {}) {
        requireAuth();
        if (adminOnly && !isAdmin()) window.location.href = 'minha-loja.html';
        if (parceiroOnly && !isParceiro()) window.location.href = 'dashboard.html';
    }

    async function api(path, options = {}) {
        const headers = options.headers ? { ...options.headers } : {};
        if (token()) headers.Authorization = `Bearer ${token()}`;
        const hasFormData = options.body instanceof FormData;
        if (!hasFormData && options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
        const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
        const text = await res.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch { data = { mensagem: text }; }
        if (!res.ok) throw new Error(data.erro || data.message || 'Erro na solicitação.');
        return data;
    }

    function money(value) {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
    }

    function number(value) {
        return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
    }

    function formDataToObject(form) {
        return Object.fromEntries(new FormData(form).entries());
    }

    function imageTag(src, extraClass = '') {
        return src ? `<img class="product-img ${extraClass}" src="${escapeHtml(src)}" alt="Produto">` : `<div class="img-placeholder ${extraClass}">Sem<br>foto</div>`;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    function badgeStatus(status) {
        const st = String(status || '').toUpperCase();
        if (['ATIVO', 'CONCLUIDA', 'PAGO', 'RECEBIDA', 'ASSINADA'].includes(st)) return `<span class="badge badge-green">${escapeHtml(st)}</span>`;
        if (['PENDENTE', 'ESTORNO_PARCIAL'].includes(st)) return `<span class="badge badge-yellow">${escapeHtml(st)}</span>`;
        if (['ENVIADA', 'ABERTA'].includes(st)) return `<span class="badge badge-blue">${escapeHtml(st)}</span>`;
        return `<span class="badge badge-red">${escapeHtml(st || 'INATIVO')}</span>`;
    }

    function toast(icon, title) {
        if (window.Swal) {
            Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2800, timerProgressBar: true }).fire({ icon, title });
        } else {
            console.log(`${icon}: ${title}`);
        }
    }

    function confirmDialog({ title, text, confirmText = 'Confirmar', icon = 'warning' }) {
        if (!window.Swal) return Promise.resolve({ isConfirmed: confirm(`${title}\n${text || ''}`) });
        return Swal.fire({ title, text, icon, showCancelButton: true, confirmButtonText: confirmText, cancelButtonText: 'Cancelar', confirmButtonColor: '#dc2626' });
    }

    function renderSidebar(active = '') {
        const side = document.getElementById('sidebar');
        if (!side) return;
        const perfil = user().perfil;
        const nome = user().nome || 'Usuário';
        const adminLinks = [
            ['dashboard', 'dashboard.html', '📊 Dashboard'],
            ['produtos', 'produtos.html', '📦 Produtos'],
            ['parceiros', 'parceiros.html', '🏪 Lojas Parceiras'],
            ['usuarios', 'usuarios.html', '👥 Usuários'],
            ['remessas', 'remessas.html', '🚚 Remessas'],
            ['vendas', 'vendas.html', '💰 Vendas'],
            ['financeiro', 'financeiro.html', '💳 Financeiro'],
            ['movimentacoes', 'movimentacoes.html', '🔄 Movimentações'],
            ['auditoria', 'auditoria.html', '🛡️ Auditoria']
        ];
        const parceiroLinks = [
            ['minha-loja', 'minha-loja.html', '🏪 Minha Loja'],
            ['dashboard', 'dashboard.html', '📊 Dashboard'],
            ['remessas', 'remessas.html', '🚚 Minhas Remessas'],
            ['vendas', 'vendas.html', '💰 Registrar Venda'],
            ['movimentacoes', 'movimentacoes.html', '🔄 Meu Histórico']
        ];
        const links = perfil === 'ADMIN' ? adminLinks : parceiroLinks;
        side.innerHTML = `
            <div class="sidebar-top">
                <div class="sidebar-brand"><strong>PERSONALIZE</strong><small>${escapeHtml(perfil || '')} • ${escapeHtml(nome)}</small></div>
                <button class="btn-menu" id="btnMenu" type="button">☰</button>
            </div>
            <nav class="sidebar-links" id="menuLinks">
                ${links.map(([key, href, label]) => `<a href="${href}" class="${key === active ? 'ativo' : ''}">${label}</a>`).join('')}
                <a href="#" class="btn-sair" id="btnSair">🚪 Sair</a>
            </nav>`;
        document.getElementById('btnMenu')?.addEventListener('click', () => document.getElementById('menuLinks')?.classList.toggle('ativo-mobile'));
        document.getElementById('btnSair')?.addEventListener('click', (e) => { e.preventDefault(); logout(); });
    }

    function bindPasswordToggle(inputId, buttonId) {
        const input = document.getElementById(inputId);
        const btn = document.getElementById(buttonId);
        if (!input || !btn) return;
        btn.addEventListener('click', () => {
            input.type = input.type === 'password' ? 'text' : 'password';
            btn.textContent = input.type === 'password' ? 'Mostrar' : 'Ocultar';
        });
    }

    async function imageToDataURL(url) {
        if (!url) return null;
        try {
            const res = await fetch(url, { mode: 'cors' });
            const blob = await res.blob();
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (err) {
            console.warn('Imagem não carregada para PDF:', err.message);
            return null;
        }
    }

    function setMsg(id, text, type = 'muted') {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text || '';
        el.className = `msg text-${type}`;
    }

    return { API_BASE, token, user, isAdmin, isParceiro, setUser, logout, requireAuth, requireAdmin, protectPage, api, money, number, formDataToObject, imageTag, escapeHtml, badgeStatus, toast, confirmDialog, renderSidebar, bindPasswordToggle, imageToDataURL, setMsg };
})();
