document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('busca');

    const campoBusca = document.getElementById('campoBusca');
    const btnBuscar  = document.getElementById('btnBuscar');
    const resultados = document.getElementById('resultadosBusca');
    const estadoVazio = document.getElementById('estadoVazio');

    // Pré-preenche com ?q= da URL
    const params = new URLSearchParams(window.location.search);
    const qInicial = params.get('q') || '';
    if (qInicial) { campoBusca.value = qInicial; executarBusca(qInicial); }

    btnBuscar.addEventListener('click', () => executarBusca(campoBusca.value.trim()));
    campoBusca.addEventListener('keydown', e => { if (e.key === 'Enter') executarBusca(campoBusca.value.trim()); });

    function renderList(containerId, cntId, rows, renderFn) {
        const el = document.getElementById(containerId);
        const cnt = document.getElementById(cntId);
        if (cnt) cnt.textContent = rows.length ? `(${rows.length})` : '';
        if (!el) return;
        el.innerHTML = rows.length
            ? rows.map(renderFn).join('')
            : '<p class="empty-state">Nenhum resultado.</p>';
    }

    async function executarBusca(q) {
        if (!q) { App.toast('warning', 'Digite um termo para buscar.'); return; }
        btnBuscar.disabled = true;
        try {
            const data = await App.api(`/busca?q=${encodeURIComponent(q)}`);
            resultados.style.display = '';
            estadoVazio.style.display = 'none';

            renderList('listaProdutos', 'cntProdutos', data.produtos || [], p => `
                <div class="dash-list-row">
                    <div class="dash-list-icon"><i class="bx bx-package"></i></div>
                    <div class="dash-list-body">
                        <strong>${App.escapeHtml(p.nome)}</strong>
                        <small>${App.escapeHtml(p.variacao || '')}${p.sku ? ' · SKU: ' + App.escapeHtml(p.sku) : ''}</small>
                    </div>
                    <div class="dash-list-value">${App.number(p.estoque_central)} <small>un.</small></div>
                </div>`);

            renderList('listaParceiros', 'cntParceiros', data.parceiros || [], p => `
                <div class="dash-list-row">
                    <div class="dash-list-icon icon-success"><i class="bx bx-store"></i></div>
                    <div class="dash-list-body">
                        <strong>${App.escapeHtml(p.nome_loja)}</strong>
                        <small>${App.escapeHtml(p.status || '')}</small>
                    </div>
                    <a href="parceiros.html" class="dash-list-value" style="font-size:12px;color:var(--primary)">Ver</a>
                </div>`);

            renderList('listaRemessas', 'cntRemessas', data.remessas || [], r => `
                <div class="dash-list-row">
                    <div class="dash-list-icon icon-warning"><i class="bx bx-box"></i></div>
                    <div class="dash-list-body">
                        <strong>${App.escapeHtml(r.codigo)}</strong>
                        <small>${App.escapeHtml(r.nome_loja || '')} · ${App.escapeHtml(r.status || '')}</small>
                    </div>
                    <a href="remessas.html" class="dash-list-value" style="font-size:12px;color:var(--primary)">Ver</a>
                </div>`);
        } catch (e) {
            App.toast('error', e.message);
        } finally {
            btnBuscar.disabled = false;
        }
    }
});
