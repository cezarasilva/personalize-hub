document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('relatorios-historico');

    const selectProduto = document.getElementById('selectProduto');
    const btnBuscar = document.getElementById('btnBuscarHistorico');
    const resultadoDiv = document.getElementById('resultadoHistorico');
    const tbody = document.getElementById('tbodyHistorico');
    const kpisDiv = document.getElementById('kpisHistorico');

    try {
        const produtos = await App.api('/produtos');
        const lista = Array.isArray(produtos) ? produtos : (produtos.rows || []);
        const vistos = new Set();
        const unicos = lista.filter(p => { if (vistos.has(p.id)) return false; vistos.add(p.id); return true; });
        selectProduto.innerHTML = '<option value="">— selecione —</option>' +
            unicos.map(p => `<option value="${p.id}">${App.escapeHtml(p.nome)}</option>`).join('');
    } catch (e) {
        App.toast('error', e.message);
    }

    btnBuscar.addEventListener('click', async () => {
        const pid = selectProduto.value;
        if (!pid) { App.toast('warning', 'Selecione um produto.'); return; }
        try {
            btnBuscar.disabled = true;
            const data = await App.api(`/estoque/historico/${pid}`);
            renderHistorico(data);
        } catch (e) {
            App.toast('error', e.message);
        } finally {
            btnBuscar.disabled = false;
        }
    });

    function renderHistorico(data) {
        resultadoDiv.style.display = '';
        const movimentos = data.movimentos || [];

        const remessas = movimentos.filter(m => m.tipo === 'REMESSA').reduce((s, m) => s + Number(m.quantidade || 0), 0);
        const vendas   = movimentos.filter(m => m.tipo === 'VENDA').reduce((s, m) => s + Number(m.quantidade || 0), 0);
        const estoque  = data.produto?.estoque_central || 0;

        kpisDiv.innerHTML = `
            <div class="stat-card accent-warning"><div class="dashboard-metric-icon icon-warning"><i class="bx bx-transfer"></i></div><span>Enviado em remessas</span><strong>${App.number(remessas)}</strong></div>
            <div class="stat-card accent-danger"><div class="dashboard-metric-icon icon-danger"><i class="bx bx-cart"></i></div><span>Vendido</span><strong>${App.number(vendas)}</strong></div>
            <div class="stat-card"><div class="dashboard-metric-icon"><i class="bx bx-package"></i></div><span>Estoque atual</span><strong>${App.number(estoque)}</strong></div>`;

        if (!movimentos.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhuma movimentação encontrada.</td></tr>';
            return;
        }

        tbody.innerHTML = movimentos.map(m => {
            const isRemessa = m.tipo === 'REMESSA';
            const data_fmt = m.data ? new Date(m.data).toLocaleDateString('pt-BR') : '—';
            return `<tr>
                <td>${data_fmt}</td>
                <td><span class="badge ${isRemessa ? 'badge-warning' : 'badge-danger'}">${App.escapeHtml(m.tipo)}</span></td>
                <td>${App.escapeHtml(m.codigo || '')}</td>
                <td class="${isRemessa ? 'text-warning' : 'text-danger'}">${App.number(m.quantidade)}</td>
                <td>${App.escapeHtml(m.destino || '—')}</td>
            </tr>`;
        }).join('');
    }

    document.getElementById('btnExportarHistorico')?.addEventListener('click', () => {
        if (!window.XLSX) { App.toast('warning', 'XLSX não carregado.'); return; }
        const rows = [['Data','Tipo','Código','Qtd.','Destino']];
        document.querySelectorAll('#tbodyHistorico tr').forEach(tr => {
            rows.push([...tr.querySelectorAll('td')].map(td => td.textContent.trim()));
        });
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Histórico');
        XLSX.writeFile(wb, 'historico-estoque.xlsx');
    });
});
