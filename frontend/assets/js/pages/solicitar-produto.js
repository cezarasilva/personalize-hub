document.addEventListener('DOMContentLoaded', () => {
    App.protectPage({ parceiroOnly: true });
    App.renderSidebar('solicitar-produto');
    let produtos = [];
    const busca = document.getElementById('buscaProduto');
    const sugestoes = document.getElementById('sugestoes');
    async function carregarProdutos() { produtos = await App.api('/parceiro/catalogo'); }
    function renderSugestoes() {
        const q = busca.value.toLowerCase().trim();
        if (!q) { sugestoes.style.display = 'none'; return; }
        const lista = produtos.filter(p => `${p.nome} ${p.variacao || ''} ${p.sku || ''}`.toLowerCase().includes(q)).slice(0, 8);
        sugestoes.innerHTML = lista.map(p => `<div class="suggestion-item" data-p="${p.produto_id}" data-v="${p.variacao_id}" data-n="${App.escapeHtml(p.nome)} - ${App.escapeHtml(p.variacao || '')}">${App.imageTag(p.imagem_url)}<div><strong>${App.escapeHtml(p.nome)}</strong><br><small>${App.escapeHtml(p.variacao || '')} • Central: ${App.number(p.estoque_central)}</small></div></div>`).join('') || '<div class="suggestion-item">Nenhum produto. Preencha o modelo desejado.</div>';
        sugestoes.style.display = 'block';
        sugestoes.querySelectorAll('[data-p]').forEach(el => el.addEventListener('click', () => { document.getElementById('produtoId').value = el.dataset.p; document.getElementById('variacaoId').value = el.dataset.v; busca.value = el.dataset.n; sugestoes.style.display = 'none'; document.getElementById('tipoSolicitacao').value = 'REPOSICAO'; }));
    }
    busca.addEventListener('input', renderSugestoes);
    document.getElementById('formSolicitacao').addEventListener('submit', async e => { e.preventDefault(); const payload = { produto_id: document.getElementById('produtoId').value || null, variacao_id: document.getElementById('variacaoId').value || null, modelo_desejado: document.getElementById('modeloDesejado').value, quantidade: document.getElementById('qtdSolicitada').value, tipo_solicitacao: document.getElementById('tipoSolicitacao').value, observacao: document.getElementById('obsSolicitacao').value }; if (!payload.produto_id && !payload.modelo_desejado) return App.toast('warning', 'Busque um produto ou descreva o modelo desejado.'); await App.api('/solicitacoes-produto', { method: 'POST', body: JSON.stringify(payload) }); e.target.reset(); document.getElementById('produtoId').value=''; document.getElementById('variacaoId').value=''; App.toast('success', 'Solicitação enviada.'); });
    document.getElementById('formCotacao').addEventListener('submit', async e => { e.preventDefault(); const fd = new FormData(e.target); await App.api('/cotacoes-produto', { method: 'POST', body: fd }); e.target.reset(); App.toast('success', 'Cotação enviada.'); });
    carregarProdutos().catch(err => App.toast('error', err.message));
});
