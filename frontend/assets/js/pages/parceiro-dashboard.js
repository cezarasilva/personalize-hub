document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage({ parceiroOnly: true });
    App.renderSidebar('parceiro-dashboard');
    try {
        const resumo = await App.api('/minha-loja/resumo');
        document.getElementById('nomeLoja').textContent = resumo.loja?.nome_loja || '-';
        document.getElementById('qtdAtual').textContent = App.number(resumo.estoque?.qtd_atual);
        document.getElementById('valorConsignado').textContent = App.money(resumo.estoque?.valor_consignado);
        document.getElementById('vendasMes').textContent = App.money(resumo.vendas?.total_vendas);
        const pend = Number(resumo.pendencias?.solicitacoes || 0) + Number(resumo.pendencias?.cotacoes || 0);
        document.getElementById('pendencias').textContent = App.number(pend);
        const estoque = await App.api(`/consignacoes/${App.user().parceiro_id}`);
        const tbody = document.getElementById('tabelaEstoque');
        if (!estoque.length) tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Sua loja ainda não tem estoque consignado.</td></tr>';
        else tbody.innerHTML = estoque.slice(0, 12).map(i => `<tr><td><div class="product-cell">${App.imageTag(i.imagem_url)}<div><strong>${App.escapeHtml(i.produto_nome)}</strong></div></div></td><td>${App.escapeHtml(i.variacao || '')}</td><td><strong>${App.number(i.quantidade_atual)}</strong></td><td>${App.money(i.preco_repasse)}</td><td><strong>${App.money(i.valor_consignado_atual)}</strong></td></tr>`).join('');
    } catch (err) { App.toast('error', err.message); }
});
