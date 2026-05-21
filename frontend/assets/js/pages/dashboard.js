document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage();
    App.renderSidebar('dashboard');
    let chart;

    function list(containerId, rows, render) {
        const el = document.getElementById(containerId);
        if (!rows || !rows.length) {
            el.innerHTML = '<p class="empty-state">Sem dados para mostrar.</p>';
            return;
        }
        el.innerHTML = rows.map(render).join('');
    }

    try {
        const dados = await App.api('/dashboard');
        document.getElementById('subtituloDashboard').textContent = dados.perfil === 'PARCEIRO' ? 'Resumo da sua loja parceira.' : 'Visão geral administrativa.';
        document.getElementById('pedidosMes').textContent = App.number(dados.pedidos_mes);
        document.getElementById('receitaMes').textContent = App.money(dados.receita_mes);
        document.getElementById('qtdEstoque').textContent = App.number(dados.patrimonio?.quantidade);
        document.getElementById('valorEstoque').textContent = App.money(dados.patrimonio?.valor);

        list('estoqueParceiros', dados.parceiros_estoque, (p) => `<div class="preview-box mt-2"><strong>${App.escapeHtml(p.nome_loja)}</strong><span class="text-muted">${App.number(p.total_produtos)} peças</span></div>`);
        list('estoqueBaixo', dados.estoque_lista, (p) => `<div class="preview-box mt-2"><strong>${App.escapeHtml(p.nome)}</strong><span class="text-danger">${App.escapeHtml(p.variacao)} • ${App.number(p.estoque_central)} un.</span></div>`);
        list('rankingProdutos', dados.ranking, (p) => `<div class="preview-box mt-2"><strong>${App.escapeHtml(p.nome)}</strong><span class="text-success">${App.number(p.total_vendido)} vendido(s)</span></div>`);

        const grafico = await App.api('/grafico-vendas');
        const ctx = document.getElementById('graficoVendas');
        chart = new Chart(ctx, {
            type: 'line',
            data: { labels: grafico.map(i => i.dia), datasets: [{ label: 'Vendas', data: grafico.map(i => Number(i.total || 0)), tension: .35, fill: false }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
        });
    } catch (err) {
        App.toast('error', err.message);
    }
});
