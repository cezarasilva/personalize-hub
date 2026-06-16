document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('relatorios-performance');

    const selMeses = document.getElementById('selMeses');
    const btnAtualizar = document.getElementById('btnAtualizar');
    const tbody = document.getElementById('tbodyPerformance');
    let dados = [];

    async function carregar() {
        const meses = selMeses.value;
        try {
            btnAtualizar.disabled = true;
            dados = await App.api(`/parceiros/performance?meses=${meses}`);
            renderTabela(dados);
        } catch (e) {
            App.toast('error', e.message);
        } finally {
            btnAtualizar.disabled = false;
        }
    }

    function renderTabela(rows) {
        if (!rows || !rows.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhum dado encontrado.</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map((r, idx) => {
            const rank = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}º`;
            const semVenda = !r.ultima_venda || r.total_vendas === '0';
            return `<tr class="${semVenda ? 'row-muted' : ''}">
                <td><strong>${rank}</strong></td>
                <td><strong>${App.escapeHtml(r.nome_loja)}</strong></td>
                <td>${App.number(r.total_vendas)}</td>
                <td>${App.number(r.pecas_vendidas)}</td>
                <td class="text-success">${App.money(r.receita_total)}</td>
                <td>${App.money(r.ticket_medio)}</td>
                <td>${App.number(r.estoque_atual)} <small>peças</small></td>
                <td>${r.ultima_venda ? App.escapeHtml(r.ultima_venda) : '<span class="badge badge-danger">Sem vendas</span>'}</td>
            </tr>`;
        }).join('');
    }

    document.getElementById('btnExportar')?.addEventListener('click', () => {
        if (!dados.length || !window.XLSX) { App.toast('warning', 'Sem dados para exportar.'); return; }
        const rows = [['#','Loja','Vendas','Peças','Receita','Ticket Médio','Estoque','Última Venda']];
        dados.forEach((r, idx) => {
            rows.push([idx + 1, r.nome_loja, Number(r.total_vendas), Number(r.pecas_vendidas),
                Number(r.receita_total), Number(r.ticket_medio), Number(r.estoque_atual), r.ultima_venda || '']);
        });
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Performance Lojas');
        XLSX.writeFile(wb, 'performance-lojas.xlsx');
    });

    btnAtualizar.addEventListener('click', carregar);
    carregar();
});
