document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage({ parceiroOnly: true });
    App.renderSidebar('assinatura');

    function fmtData(data) { return data ? new Date(data).toLocaleDateString('pt-BR') : '-'; }

    try {
        const dados = await App.api('/assinaturas/minha');
        const a = dados.assinatura || {};
        document.getElementById('assinaturaStatus').innerHTML = App.badgeStatus(a.status || '-');
        document.getElementById('assinaturaDias').textContent = Number(a.dias_restantes || 0);
        document.getElementById('assinaturaValor').textContent = App.money(a.valor_mensal || 0);
        document.getElementById('detalhesAssinatura').innerHTML = `
            <div class="assinatura-panel">
                <p><strong>Plano:</strong> ${App.escapeHtml(a.plano || 'CATALOGO_BASICO')}</p>
                <p><strong>Início do teste:</strong> ${fmtData(a.inicio_teste)}</p>
                <p><strong>Fim do teste:</strong> ${fmtData(a.fim_teste)}</p>
                <p><strong>Próxima cobrança:</strong> ${fmtData(a.proxima_cobranca)}</p>
                <p class="text-muted">Enquanto estiver em teste grátis ou ativa, seu catálogo permanece disponível para clientes finais.</p>
            </div>`;
        const cobrancas = dados.cobrancas || [];
        document.getElementById('minhasCobrancas').innerHTML = !cobrancas.length ? '<p class="empty-state">Nenhuma cobrança encontrada.</p>' :
            `<div class="responsive-table"><table><thead><tr><th>Código</th><th>Mês</th><th>Valor</th><th>Status</th><th>Vencimento</th></tr></thead><tbody>${cobrancas.map(c => `<tr><td>${App.escapeHtml(c.codigo || '')}</td><td>${App.escapeHtml(c.mes_referencia || '')}</td><td>${App.money(c.valor || 0)}</td><td>${App.badgeStatus(c.status)}</td><td>${fmtData(c.vencimento)}</td></tr>`).join('')}</tbody></table></div>`;
    } catch (err) { App.toast('error', err.message); }
});
