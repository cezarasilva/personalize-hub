document.addEventListener('DOMContentLoaded', () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('auditoria');
    const tabela = document.getElementById('tabelaLogs');
    async function carregar() {
        const logs = await App.api('/logs');
        if (!logs.length) return tabela.innerHTML = '<tr><td colspan="4" class="empty-state">Nenhum log registrado.</td></tr>';
        tabela.innerHTML = logs.map(l => `<tr><td>${l.id}</td><td>${App.escapeHtml(l.data_formatada || '')}</td><td>${App.escapeHtml(l.usuario || 'Sistema')}</td><td>${App.escapeHtml(l.acao)}</td></tr>`).join('');
    }
    carregar().catch(err => tabela.innerHTML = `<tr><td colspan="4" class="empty-state">${App.escapeHtml(err.message)}</td></tr>`);
});
