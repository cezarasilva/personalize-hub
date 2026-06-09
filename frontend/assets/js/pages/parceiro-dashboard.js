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
    } catch (err) { App.toast('error', err.message); }

    try {
        const leads = await App.api('/catalogo-pedidos?status=NOVO');
        const tbody = document.getElementById('tabelaLeads');
        const badge = document.getElementById('badgeLeads');
        if (!leads.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum lead aguardando resposta.</td></tr>';
        } else {
            badge.textContent = leads.length;
            badge.classList.remove('hidden');
            tbody.innerHTML = leads.slice(0, 15).map(l => {
                const nome = l.produto_nome_snapshot || (l.itens?.[0]?.produto_nome) || '-';
                const variacao = l.variacao_snapshot || (l.itens?.[0]?.variacao) || '';
                const data = l.criado_em ? new Date(l.criado_em).toLocaleDateString('pt-BR') : '-';
                return `<tr>
                    <td><strong>${App.escapeHtml(l.codigo || '#' + l.id)}</strong></td>
                    <td>${App.escapeHtml(l.cliente_nome || '-')}<br><small class="text-muted">${App.escapeHtml(l.cliente_whatsapp || '')}</small></td>
                    <td>${App.escapeHtml(nome)}${variacao ? '<br><small>' + App.escapeHtml(variacao) + '</small>' : ''}</td>
                    <td>${App.number(l.quantidade)}</td>
                    <td><strong>${App.money(l.subtotal || 0)}</strong></td>
                    <td>${data}</td>
                    <td><a href="catalogo-pedidos.html" class="btn btn-sm btn-primary">Atender</a></td>
                </tr>`;
            }).join('');
        }
    } catch (err) { /* leads opcionais, não bloqueia o painel */ }
});
