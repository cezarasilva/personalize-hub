document.addEventListener('DOMContentLoaded', () => {
    App.protectPage({ parceiroOnly: true });
    App.renderSidebar('catalogo-parceiro');
    const grid = document.getElementById('cardsProdutos');
    async function carregar() {
        const busca = encodeURIComponent(document.getElementById('busca').value || '');
        const disp = document.getElementById('filtroDisponivel').value;
        const produtos = await App.api(`/parceiro/catalogo?busca=${busca}&disponivel=${disp}`);
        if (!produtos.length) { grid.innerHTML = '<div class="card empty-state">Nenhum produto encontrado.</div>'; return; }
        grid.innerHTML = produtos.map(p => `<article class="card"><div class="product-cell mb-2">${App.imageTag(p.imagem_url, 'product-img-lg')}<div><strong>${App.escapeHtml(p.nome)}</strong><br><small>${App.escapeHtml(p.variacao || '')} ${p.sku ? '• SKU ' + App.escapeHtml(p.sku) : ''}</small></div></div><p class="text-muted">${App.escapeHtml(p.categoria || '')}</p><div class="grid grid-2 mt-2"><div class="compact-stat stat-card"><span>Central</span><strong>${App.number(p.estoque_central)}</strong></div><div class="compact-stat stat-card"><span>Na loja</span><strong>${App.number(p.quantidade_na_loja)}</strong></div></div><p class="mt-2"><strong>Repasse:</strong> ${App.money(p.preco_repasse)}<br><strong>Venda:</strong> ${App.money(p.preco_venda)}</p><button class="btn btn-success w-full mt-2" data-id="${p.produto_id}" data-var="${p.variacao_id}" data-nome="${App.escapeHtml(p.nome)}">Solicitar reposição</button></article>`).join('');
        grid.querySelectorAll('button[data-id]').forEach(btn => btn.addEventListener('click', () => solicitar(btn.dataset.id, btn.dataset.var, btn.dataset.nome)));
    }
    async function solicitar(produto_id, variacao_id, nome) {
        const { value } = await Swal.fire({ title: `Solicitar ${nome}`, html: '<input id="qtd" type="number" min="1" class="swal2-input" placeholder="Quantidade" value="5"><textarea id="obs" class="swal2-textarea" placeholder="Observação opcional"></textarea>', showCancelButton: true, confirmButtonText: 'Enviar solicitação', cancelButtonText: 'Cancelar', preConfirm: () => ({ quantidade: document.getElementById('qtd').value, observacao: document.getElementById('obs').value }) });
        if (!value) return;
        await App.api('/solicitacoes-produto', { method: 'POST', body: JSON.stringify({ produto_id, variacao_id, quantidade: value.quantidade, observacao: value.observacao, tipo_solicitacao: 'REPOSICAO' }) });
        App.toast('success', 'Solicitação enviada.');
    }
    document.getElementById('btnBuscar').addEventListener('click', carregar);
    document.getElementById('busca').addEventListener('keydown', e => { if (e.key === 'Enter') carregar(); });
    carregar().catch(err => App.toast('error', err.message));
});
