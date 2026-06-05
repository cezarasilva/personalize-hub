document.addEventListener('DOMContentLoaded', () => {
    App.protectPage();
    App.renderSidebar('movimentacoes');
    const tabela = document.getElementById('tabelaMovimentacoes');
    const aviso = document.getElementById('avisoMovimentacoes');
    async function carregar() {
        const dados = await App.api('/movimentacoes');
        const linhas = Array.isArray(dados) ? dados : (dados.linhas || []);
        if (dados.aviso) { aviso.textContent = dados.aviso; aviso.classList.remove('hidden'); }
        if (!linhas.length) return tabela.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhuma movimentação registrada.</td></tr>';
        tabela.innerHTML = linhas.map(m => `<tr><td>${App.escapeHtml(m.data_formatada || '')}</td><td><span class="badge badge-blue">${App.escapeHtml(m.tipo)}</span></td><td>${App.escapeHtml(m.produto_nome || '-')}<br><small>${App.escapeHtml(m.variacao || '')}</small></td><td>${App.escapeHtml(m.nome_loja || '-')}</td><td><strong>${App.number(m.quantidade)}</strong></td><td>${App.escapeHtml(m.estoque_origem || '-')}</td><td>${App.escapeHtml(m.usuario || '-')}</td><td>${App.escapeHtml(m.observacao || '-')}</td></tr>`).join('');
    }
    carregar().catch(err => tabela.innerHTML = `<tr><td colspan="8" class="empty-state">${App.escapeHtml(err.message)}</td></tr>`);
});
