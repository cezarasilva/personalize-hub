document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('dashboard');

    function list(containerId, rows, render) {
        const el = document.getElementById(containerId);
        if (!el) return;
        if (!rows || !rows.length) {
            el.innerHTML = '<p class="empty-state">Sem dados para mostrar.</p>';
            return;
        }
        el.innerHTML = rows.map(render).join('');
    }

    function makeLineChart(canvasId, labels, data, label) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        return new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label,
                    data,
                    tension: .35,
                    fill: true,
                    borderWidth: 3,
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#e5e7eb' } } },
                scales: {
                    x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.12)' } },
                    y: { beginAtZero: true, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.12)' } }
                }
            }
        });
    }

    try {
        const dados = await App.api('/dashboard');
        document.getElementById('pedidosMes').textContent = App.number(dados.pedidos_mes);
        document.getElementById('receitaMes').textContent = App.money(dados.receita_mes);
        document.getElementById('qtdEstoque').textContent = App.number(dados.patrimonio?.quantidade);
        document.getElementById('qtdConsignado').textContent = App.number(dados.patrimonio?.quantidade_consignada);
        document.getElementById('qtdTotalGeral').textContent = App.number(Number(dados.patrimonio?.quantidade || 0) + Number(dados.patrimonio?.quantidade_consignada || 0));
        document.getElementById('valorEstoque').textContent = App.money(dados.patrimonio?.valor);
        const elVendaEstoque = document.getElementById('valorEstoqueVenda');
        if (elVendaEstoque) elVendaEstoque.textContent = App.money(dados.patrimonio?.valor_venda);

        const custoEstoque = Number(dados.patrimonio?.valor || 0);
        const valorVendaEstoque = Number(dados.patrimonio?.valor_venda || 0);
        document.getElementById('lucroPotencial').textContent = App.money(valorVendaEstoque - custoEstoque);

        const pedidosMes = Number(dados.pedidos_mes || 0);
        const receitaMes = Number(dados.receita_mes || 0);
        document.getElementById('ticketMedio').textContent = App.money(pedidosMes > 0 ? receitaMes / pedidosMes : 0);

        document.getElementById('parceirosAtivos').textContent = App.number(dados.parceiros_ativos);
        document.getElementById('remessasPendentes').textContent = App.number(dados.remessas_pendentes_assinatura);

        list('estoqueParceiros', dados.parceiros_estoque, (p) => `<div class="preview-box mt-2"><strong>${App.escapeHtml(p.nome_loja)}</strong><span class="text-muted">${App.number(p.total_produtos)} peças</span></div>`);
        list('estoqueBaixo', dados.estoque_lista, (p) => `<div class="preview-box mt-2"><strong>${App.escapeHtml(p.nome)}</strong><span class="text-danger">${App.escapeHtml(p.variacao)} • ${App.number(p.estoque_central)} un.</span></div>`);
        list('insumosBaixo', dados.insumos_baixo, (i) => `<div class="preview-box mt-2"><strong>${App.escapeHtml(i.nome)}</strong><span class="text-danger">${App.number(i.estoque_atual)} / mín. ${App.number(i.estoque_minimo)} ${App.escapeHtml(i.unidade || '')}</span></div>`);
        list('rankingProdutos', dados.ranking, (p) => `<div class="preview-box mt-2"><strong>${App.escapeHtml(p.nome)}</strong><span class="text-success">${App.number(p.total_vendido)} vendido(s)</span></div>`);

        const crescimento = await App.api('/dashboard/crescimento');
        makeLineChart(
            'graficoCrescimentoVendas',
            crescimento.vendas.map(i => i.mes),
            crescimento.vendas.map(i => Number(i.total || 0)),
            'Vendas / receita'
        );
        makeLineChart(
            'graficoParcerias',
            crescimento.parceiros.map(i => i.mes),
            crescimento.parceiros.map(i => Number(i.total || 0)),
            'Novas parcerias'
        );
    } catch (err) {
        App.toast('error', err.message);
    }
});
