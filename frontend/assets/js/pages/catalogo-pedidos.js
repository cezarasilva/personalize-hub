document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage();
    App.renderSidebar('catalogo-pedidos');

    let pedidos = [];

    function statusOptions(statusAtual) {
        const opts = ['NOVO', 'EM_ATENDIMENTO', 'ORCADO', 'FECHADO', 'PERDIDO', 'CANCELADO'];
        return opts.map(s => `<option value="${s}" ${s === statusAtual ? 'selected' : ''}>${s.replaceAll('_',' ')}</option>`).join('');
    }

    function render() {
        const st = document.getElementById('filtroStatus').value;
        const lista = document.getElementById('listaPedidos');
        const filtrados = pedidos.filter(p => !st || p.status === st);

        if (!filtrados.length) {
            lista.innerHTML = '<p class="empty-state">Nenhum lead/pedido encontrado.</p>';
            return;
        }

        lista.innerHTML = filtrados.map(p => {
            const whats = String(p.cliente_whatsapp || '').replace(/\D/g, '');
            const msg = encodeURIComponent(`Olá ${p.cliente_nome || ''}! Recebemos seu pedido do produto ${p.produto_nome_snapshot || ''}.`);
            return `
                <div class="lead-card">
                    <div>
                        <strong>${App.escapeHtml(p.codigo || 'Pedido')}</strong>
                        <div class="text-muted">${App.escapeHtml(p.nome_loja || 'Catálogo admin')} • ${new Date(p.criado_em).toLocaleString('pt-BR')}</div>
                        <div class="mt-2"><strong>Cliente:</strong> ${App.escapeHtml(p.cliente_nome || '')} • ${App.escapeHtml(p.cliente_whatsapp || '')}</div>
                        <div><strong>Produto:</strong> ${App.escapeHtml(p.produto_nome_snapshot || '')} (${App.escapeHtml(p.variacao_snapshot || '')})</div>
                        <div><strong>Qtd:</strong> ${App.number(p.quantidade)} • <strong>Valor unit.:</strong> ${App.money(p.valor_unitario_snapshot)}</div>
                        <div class="text-muted">${App.escapeHtml(p.observacao || '')}</div>
                        <div class="mt-2">${App.badgeStatus(p.status)}</div>
                    </div>
                    <div style="display:grid; gap:8px; min-width:190px;">
                        <select onchange="alterarStatusPedido(${p.id}, this.value)">${statusOptions(p.status)}</select>
                        ${whats ? `<a class="btn btn-success" target="_blank" href="https://wa.me/55${whats}?text=${msg}"><i class="bx bxl-whatsapp"></i> Chamar</a>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    window.alterarStatusPedido = async (id, status) => {
        try {
            await App.api(`/catalogo-pedidos/${id}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ status })
            });
            App.toast('success', 'Status atualizado.');
            await carregar();
        } catch (err) {
            App.toast('error', err.message);
        }
    };

    async function carregar() {
        pedidos = await App.api('/catalogo-pedidos');
        render();
    }

    document.getElementById('filtroStatus').addEventListener('change', render);

    try { await carregar(); } catch (err) { App.toast('error', err.message); }
});
