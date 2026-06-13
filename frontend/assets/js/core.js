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
        if (!token()) window.location.replace('index.html');
    }

    function requireAdmin() {
        requireAuth();
        if (!isAdmin()) window.location.replace('parceiro-dashboard.html');
    }

    // ---- Loading overlay ----
    function _mostrarLoader() {
        if (document.getElementById('ph-page-loader')) return;
        const el = document.createElement('div');
        el.id = 'ph-page-loader';
        el.innerHTML = `
            <style>
                #ph-page-loader{position:fixed;inset:0;z-index:99999;background:var(--bg,#f7f8fc);
                    display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;
                    transition:opacity .25s;}
                #ph-page-loader .ph-spin{width:38px;height:38px;border:3px solid var(--border,#e8edf4);
                    border-top-color:var(--primary,#6366f1);border-radius:50%;
                    animation:ph-spin-anim .7s linear infinite;}
                @keyframes ph-spin-anim{to{transform:rotate(360deg);}}
            </style>
            <div class="ph-spin"></div>
            <span style="font-size:13px;font-weight:600;color:var(--muted,#94a3b8);">Verificando acesso...</span>`;
        document.body.insertBefore(el, document.body.firstChild);
    }

    function _esconderLoader() {
        const el = document.getElementById('ph-page-loader');
        if (!el) return;
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 280);
    }

    async function protectPage({ adminOnly = false, parceiroOnly = false } = {}) {
        if (!token()) { window.location.replace('index.html'); return; }
        _mostrarLoader();
        try {
            const me = await api('/me');
            // Atualiza perfil no localStorage com dados frescos
            const dadosAtual = user();
            localStorage.setItem('usuario_personalize', JSON.stringify({ ...dadosAtual, ...me }));
            const perfil = (me.perfil || dadosAtual.perfil || '').toUpperCase();
            if (adminOnly   && perfil !== 'ADMIN')    { window.location.replace('parceiro-dashboard.html'); return; }
            if (parceiroOnly && perfil !== 'PARCEIRO'){ window.location.replace('dashboard.html'); return; }
            _esconderLoader();
        } catch {
            localStorage.clear();
            window.location.replace('index.html');
        }
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
        if (['ATIVO', 'CONCLUIDA', 'CONCLUÍDA', 'PAGO', 'RECEBIDA', 'ASSINADA', 'APROVADA'].includes(st)) return `<span class="badge badge-green">${escapeHtml(st)}</span>`;
        if (['PENDENTE', 'ESTORNO_PARCIAL', 'SEPARACAO', 'DESENVOLVIMENTO', 'AGUARDANDO_APROVACAO', 'PRODUCAO', 'TRANSPORTE'].includes(st)) return `<span class="badge badge-yellow">${escapeHtml(st)}</span>`;
        if (['ENVIADA', 'ABERTA'].includes(st)) return `<span class="badge badge-blue">${escapeHtml(st)}</span>`;
        return `<span class="badge badge-red">${escapeHtml(st || 'INATIVO')}</span>`;
    }

    function toast(icon, title) {
        if (window.Swal) {
            Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2800, timerProgressBar: true }).fire({ icon, title });
            return;
        }
        const tipo = icon === 'success' ? 'success' : icon === 'error' ? 'error' : icon === 'warning' ? 'warning' : 'info';
        let container = document.querySelector('.ph-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'ph-toast-container';
            document.body.appendChild(container);
        }
        const item = document.createElement('div');
        item.className = `ph-toast ${tipo}`;
        item.innerHTML = `<i class="bx ${tipo === 'success' ? 'bx-check-circle' : tipo === 'error' ? 'bx-x-circle' : tipo === 'warning' ? 'bx-error' : 'bx-info-circle'}"></i><span>${escapeHtml(title)}</span>`;
        container.appendChild(item);
        setTimeout(() => { item.style.opacity = '0'; item.style.transform = 'translateY(-6px)'; }, 2600);
        setTimeout(() => item.remove(), 3100);
    }

    function confirmDialog({ title, text, confirmText = 'Confirmar', icon = 'warning' }) {
        if (!window.Swal) return Promise.resolve({ isConfirmed: confirm(`${title}\n${text || ''}`) });
        return Swal.fire({ title, text, icon, showCancelButton: true, confirmButtonText: confirmText, cancelButtonText: 'Cancelar', confirmButtonColor: '#dc2626' });
    }

    function icon(name) {
        return `<i class="bx ${name}"></i>`;
    }

    function copyText(texto, mensagem = 'Copiado com sucesso!') {
        if (!texto) return;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(texto).then(() => toast('success', mensagem)).catch(() => toast('warning', 'Não foi possível copiar automaticamente.'));
        } else {
            const input = document.createElement('textarea');
            input.value = texto;
            document.body.appendChild(input);
            input.select();
            try { document.execCommand('copy'); toast('success', mensagem); } catch { toast('warning', 'Não foi possível copiar automaticamente.'); }
            input.remove();
        }
    }

    function dateBR(value) {
        if (!value) return '-';
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('pt-BR');
    }

    const SIDEBAR_KEY = 'ph-sidebar-collapsed';

    function renderSidebar(active = '') {
        const side = document.getElementById('sidebar');
        if (!side) return;
        const perfil = user().perfil;
        const nome = user().nome || 'Usuário';
        const adminLinks = [
            ['dashboard', 'dashboard.html', 'bxs-dashboard', 'Dashboard'],
            ['produtos-grupo', '#', 'bxs-package', 'Estoque'],
            ['produtos-lista', 'produtos-lista.html', 'bx-list-ul', 'Lista de Produtos'],
            ['produtos-cadastro', 'produtos-cadastro.html', 'bx-plus-circle', 'Cadastrar Produto'],
            ['produtos-insumos', 'produtos-insumos.html', 'bx-box', 'Cadastro de Insumos'],
            ['catalogo-admin', 'catalogo.html?loja=personalize', 'bx-store-alt', 'Catálogo Admin'],
            ['meu-catalogo', 'meu-catalogo.html', 'bx-slider-alt', 'Config. Catálogo'],
            ['catalogo-pedidos', 'catalogo-pedidos.html', 'bx-message-square-dots', 'Leads / Pedidos'],
            ['assinaturas', 'assinaturas.html', 'bx-receipt', 'Assinaturas'],
            ['maquinas', 'maquinas.html', 'bx-printer', 'Máquinas'],
            ['parceiros', 'parceiros.html', 'bx-buildings', 'Lojas Parceiras'],
            ['usuarios', 'usuarios.html', 'bx-group', 'Usuários'],
            ['solicitacoes', 'solicitacoes.html', 'bx-task', 'Solicitações'],
            ['remessas', 'remessas.html', 'bx-package', 'Remessas'],
            ['vendas', 'vendas.html', 'bx-cart-add', 'Vendas'],
            ['financeiro', 'financeiro.html', 'bx-credit-card', 'Financeiro'],
            ['movimentacoes', 'movimentacoes.html', 'bx-transfer', 'Movimentações'],
            ['auditoria', 'auditoria.html', 'bx-shield-quarter', 'Auditoria']
        ];
        const parceiroLinks = [
            ['parceiro-dashboard', 'parceiro-dashboard.html', 'bxs-home', 'Painel da Loja'],
            ['meu-catalogo', 'meu-catalogo.html', 'bx-store', 'Meu Catálogo'],
            ['meus-produtos', 'meus-produtos.html', 'bx-purchase-tag', 'Meus Produtos'],
            ['catalogo-parceiro', 'catalogo-parceiro.html', 'bx-grid-alt', 'Produtos Disponíveis'],
            ['catalogo-pedidos', 'catalogo-pedidos.html', 'bx-message-square-dots', 'Leads / Pedidos'],
            ['assinatura', 'assinatura.html', 'bx-receipt', 'Minha Assinatura'],
            ['solicitar-produto', 'solicitar-produto.html', 'bx-message-square-add', 'Solicitar Produto'],
            ['minhas-cotacoes', 'minhas-cotacoes.html', 'bx-list-check', 'Minhas Solicitações'],
            ['remessas', 'remessas.html', 'bx-package', 'Minhas Remessas'],
            ['vendas', 'vendas.html', 'bx-cart', 'Registrar Venda'],
            ['movimentacoes', 'movimentacoes.html', 'bx-transfer', 'Meu Histórico']
        ];
        const links = perfil === 'ADMIN' ? adminLinks : parceiroLinks;

        // Aplica estado salvo antes de renderizar (evita flash)
        const isCollapsed = localStorage.getItem(SIDEBAR_KEY) === '1';
        if (isCollapsed) side.classList.add('collapsed');
        else side.classList.remove('collapsed');

        // Gera HTML dos links agrupando os submenus em sidebar-group-wrap
        const linksHtml = (() => {
            let html = '';
            let i = 0;
            while (i < links.length) {
                const [key, href, iconName, label] = links[i];
                if (key === 'produtos-grupo') {
                    // Coleta itens do submenu (chaves que começam com 'produtos-' exceto o grupo)
                    const subItems = [];
                    let j = i + 1;
                    while (j < links.length && links[j][0].startsWith('produtos-')) {
                        const [sk, shref, si, sl] = links[j];
                        const sCls = `submenu-link${sk === active ? ' ativo' : ''}`;
                        subItems.push(`<a href="${shref}" class="${sCls}" data-label="${escapeHtml(sl)}">${icon(si)}<span>${escapeHtml(sl)}</span></a>`);
                        j++;
                    }
                    const isSubActive = links.slice(i + 1, j).some(([sk]) => sk === active);
                    html += `<div class="sidebar-group-wrap${isSubActive ? ' open' : ''}">
                        <button class="sidebar-group" type="button" data-label="${escapeHtml(label)}">
                            ${icon(iconName)}<span>${escapeHtml(label)}</span>
                            <i class="bx bx-chevron-down sidebar-group-arrow"></i>
                        </button>
                        <div class="submenu-items">${subItems.join('')}</div>
                    </div>`;
                    i = j;
                } else {
                    const cls = key === active ? 'ativo' : '';
                    html += `<a href="${href}" class="${cls}" data-label="${escapeHtml(label)}">${icon(iconName)}<span>${escapeHtml(label)}</span></a>`;
                    i++;
                }
            }
            return html;
        })();

        const initials = nome.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
        const temaAtual = localStorage.getItem('ph-theme') || 'light';

        side.innerHTML = `
            <div class="sidebar-top">
                <div class="sidebar-brand">
                    <strong>PERSONALIZE</strong>
                    <small>${escapeHtml(perfil || '')} • ${escapeHtml(nome)}</small>
                </div>
                <div class="sidebar-top-btns">
                    <button class="btn-sidebar-toggle" id="btnSidebarToggle" type="button"
                            title="${isCollapsed ? 'Expandir menu' : 'Recolher menu'}">
                        <i class="bx ${isCollapsed ? 'bx-chevrons-right' : 'bx-chevrons-left'}"></i>
                    </button>
                    <button class="btn-menu" id="btnMenu" type="button">
                        <i class="bx bx-menu"></i>
                    </button>
                </div>
            </div>
            <nav class="sidebar-links" id="menuLinks">
                ${linksHtml}
            </nav>
            <div class="sidebar-footer" id="sidebarFooter">
                <div class="sidebar-config-panel" id="sidebarConfigPanel">
                    <div class="sc-user-info">
                        <div class="sc-avatar">${escapeHtml(initials || '?')}</div>
                        <div>
                            <strong>${escapeHtml(nome)}</strong>
                            <small>${escapeHtml(perfil || '')}</small>
                        </div>
                    </div>
                    <div class="sc-divider"></div>
                    <button class="sc-item" id="scToggleTema" type="button">
                        <i class="bx ${temaAtual === 'dark' ? 'bx-sun' : 'bx-moon'}"></i>
                        <span>${temaAtual === 'dark' ? 'Modo Light' : 'Modo Dark'}</span>
                        <div class="sc-switch ${temaAtual === 'dark' ? 'on' : ''}" id="scSwitch"></div>
                    </button>
                    <div class="sc-divider"></div>
                    <button class="sc-item" id="scAlterarSenha" type="button">
                        <i class="bx bx-lock-alt"></i>
                        <span>Alterar senha</span>
                    </button>
                    <div class="sc-divider"></div>
                    <button class="sc-item sc-item--danger" id="scSair" type="button">
                        <i class="bx bx-log-out"></i>
                        <span>Sair</span>
                    </button>
                </div>
                <button class="sidebar-config-btn" id="btnSidebarConfig" type="button" data-label="Configurações">
                    <i class="bx bx-cog"></i>
                    <span>Configurações</span>
                    <i class="bx bx-chevron-up sidebar-config-arrow"></i>
                </button>
            </div>`;

        // Toggle recolher/expandir (desktop)
        document.getElementById('btnSidebarToggle')?.addEventListener('click', () => {
            const collapsed = side.classList.toggle('collapsed');
            localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
            const btn = document.getElementById('btnSidebarToggle');
            if (btn) {
                btn.title = collapsed ? 'Expandir menu' : 'Recolher menu';
                btn.querySelector('i').className = `bx ${collapsed ? 'bx-chevrons-right' : 'bx-chevrons-left'}`;
            }
        });

        // Submenu Produtos — toggle no modo expandido, flyout no modo recolhido
        side.querySelectorAll('.sidebar-group-wrap').forEach(wrap => {
            const btn = wrap.querySelector('button.sidebar-group');
            const submenu = wrap.querySelector('.submenu-items');
            if (!btn || !submenu) return;

            // Clique: expande/recolhe (só no modo expandido)
            btn.addEventListener('click', () => {
                if (side.classList.contains('collapsed')) return;
                wrap.classList.toggle('open');
            });

            // Hover: flyout no modo recolhido
            let leaveTimer;
            const showFlyout = () => {
                if (!side.classList.contains('collapsed')) return;
                clearTimeout(leaveTimer);
                const rect = wrap.getBoundingClientRect();
                submenu.style.top = rect.top + 'px';
                submenu.classList.add('flyout-visible');
            };
            const hideFlyout = () => {
                leaveTimer = setTimeout(() => submenu.classList.remove('flyout-visible'), 120);
            };
            wrap.addEventListener('mouseenter', showFlyout);
            wrap.addEventListener('mouseleave', hideFlyout);
            submenu.addEventListener('mouseenter', () => clearTimeout(leaveTimer));
            submenu.addEventListener('mouseleave', hideFlyout);
        });

        // ---- Helpers de overlay ----
        function _abrirOverlay(onClose) {
            _fecharOverlay();
            const ov = document.createElement('div');
            ov.id = 'ph-overlay';
            ov.addEventListener('click', () => { onClose(); _fecharOverlay(); });
            document.body.appendChild(ov);
        }
        function _fecharOverlay() {
            document.getElementById('ph-overlay')?.remove();
        }

        // ---- Dropdown mobile (nav links) — comportamento original ----
        document.getElementById('btnMenu')?.addEventListener('click', () =>
            document.getElementById('menuLinks')?.classList.toggle('ativo-mobile'));

        // Fecha ao clicar em link de navegação
        document.querySelectorAll('#menuLinks a[href]').forEach(a => {
            a.addEventListener('click', () => {
                document.getElementById('menuLinks')?.classList.remove('ativo-mobile');
            });
        });

        // ---- Painel de Configurações ----
        const footer   = document.getElementById('sidebarFooter');
        const panel    = document.getElementById('sidebarConfigPanel');
        const cfgBtn   = document.getElementById('btnSidebarConfig');

        cfgBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            const abrindo = !footer?.classList.contains('open');
            // Em collapsed desktop, posiciona o flyout
            if (side.classList.contains('collapsed') && panel) {
                const rect = cfgBtn.getBoundingClientRect();
                panel.style.bottom = (window.innerHeight - rect.bottom) + 'px';
                panel.style.top = 'auto';
            }
            footer?.classList.toggle('open');
            // Overlay apenas no mobile (bottom sheet):
            // no desktop o z-index do overlay ficaria acima do sidebar
            // bloqueando os itens do painel — usa document.click em vez disso
            if (window.innerWidth <= 768) {
                if (abrindo) {
                    _abrirOverlay(() => footer?.classList.remove('open'));
                } else {
                    _fecharOverlay();
                }
            }
        });

        // Desktop: fecha ao clicar fora do sidebar
        document.addEventListener('click', (e) => {
            if (window.innerWidth > 768
                && footer?.classList.contains('open')
                && !side.contains(e.target)) {
                footer.classList.remove('open');
            }
        });

        // Tema toggle
        document.getElementById('scToggleTema')?.addEventListener('click', () => {
            const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('ph-theme', next);
            const btn  = document.getElementById('scToggleTema');
            const sw   = document.getElementById('scSwitch');
            if (btn) {
                btn.querySelector('i').className = `bx ${next === 'dark' ? 'bx-sun' : 'bx-moon'}`;
                btn.querySelector('span').textContent = next === 'dark' ? 'Modo Light' : 'Modo Dark';
            }
            if (sw) sw.classList.toggle('on', next === 'dark');
        });

        // Alterar senha — abre modal
        document.getElementById('scAlterarSenha')?.addEventListener('click', () => {
            footer?.classList.remove('open');
            _abrirModalSenha();
        });

        // Sair
        document.getElementById('scSair')?.addEventListener('click', () => logout());
    }

    function _abrirModalSenha() {
        if (document.getElementById('phModalSenha')) return;
        const overlay = document.createElement('div');
        overlay.id = 'phModalSenha';
        overlay.className = 'ph-modal-overlay';
        overlay.innerHTML = `
            <div class="ph-modal-box">
                <div class="ph-modal-header">
                    <h3><i class="bx bx-lock-alt"></i> Alterar Senha</h3>
                    <button class="ph-modal-close" id="phModalClose" type="button"><i class="bx bx-x"></i></button>
                </div>
                <div class="ph-modal-body">
                    <div class="form-group">
                        <label>Senha atual</label>
                        <input type="password" id="phSenhaAtual" placeholder="••••••••" autocomplete="current-password">
                    </div>
                    <div class="form-group mt-2">
                        <label>Nova senha</label>
                        <input type="password" id="phNovaSenha" placeholder="mínimo 6 caracteres" autocomplete="new-password">
                    </div>
                    <div class="form-group mt-2">
                        <label>Confirmar nova senha</label>
                        <input type="password" id="phConfirmarSenha" placeholder="repita a nova senha" autocomplete="new-password">
                    </div>
                    <p class="ph-modal-msg" id="phModalMsg"></p>
                </div>
                <div class="ph-modal-footer">
                    <button class="btn btn-light" id="phModalCancelar" type="button">Cancelar</button>
                    <button class="btn btn-primary" id="phModalSalvar" type="button">
                        <i class="bx bx-check"></i> Salvar
                    </button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const fechar = () => overlay.remove();
        document.getElementById('phModalClose')?.addEventListener('click', fechar);
        document.getElementById('phModalCancelar')?.addEventListener('click', fechar);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });

        document.getElementById('phModalSalvar')?.addEventListener('click', async () => {
            const msg       = document.getElementById('phModalMsg');
            const atual     = document.getElementById('phSenhaAtual')?.value.trim();
            const nova      = document.getElementById('phNovaSenha')?.value;
            const confirmar = document.getElementById('phConfirmarSenha')?.value;
            msg.textContent = '';
            msg.className   = 'ph-modal-msg';
            if (!atual || !nova) { msg.textContent = 'Preencha todos os campos.'; msg.classList.add('error'); return; }
            if (nova.length < 6)  { msg.textContent = 'A nova senha deve ter ao menos 6 caracteres.'; msg.classList.add('error'); return; }
            if (nova !== confirmar){ msg.textContent = 'As senhas não coincidem.'; msg.classList.add('error'); return; }
            const salvarBtn = document.getElementById('phModalSalvar');
            salvarBtn.disabled = true;
            try {
                await api('/usuarios/me/senha', {
                    method: 'PUT',
                    body: JSON.stringify({ senhaAtual: atual, novaSenha: nova })
                });
                msg.textContent = '✓ Senha alterada com sucesso!';
                msg.classList.add('success');
                setTimeout(fechar, 1400);
            } catch (err) {
                msg.textContent = err.message || 'Erro ao alterar senha.';
                msg.classList.add('error');
                salvarBtn.disabled = false;
            }
        });
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

    return { API_BASE, token, user, isAdmin, isParceiro, setUser, logout, requireAuth, requireAdmin, protectPage, api, money, number, formDataToObject, imageTag, escapeHtml, badgeStatus, toast, confirmDialog, icon, renderSidebar, bindPasswordToggle, imageToDataURL, setMsg };
})();
