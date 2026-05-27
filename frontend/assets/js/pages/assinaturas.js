document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('assinaturas');

    let assinaturas = [];
    let cobrancas = [];

    function statusBadge(status) { return App.badgeStatus(status || ''); }
    function fmtData(data) { return data ? new Date(data).toLocaleDateString('pt-BR') : '-'; }

    function renderStats() {
        const teste = assinaturas.filter(a => a.status === 'TESTE_GRATIS').length;
        const ativas = assinaturas.filter(a => a.status === 'ATIVA').length;
        const pendentes = assinaturas.filter(a => a.status === 'PENDENTE').length;
        const valor = cobrancas.filter(c => c.status === 'PENDENTE').reduce((s,c) => s + Number(c.valor || 0), 0);
        document.getElementById('statTeste').textContent = teste;
        document.getElementById('statAtivas').textContent = ativas;
        document.getElementById('statPendentes').textContent = pendentes;
        document.getElementById('statValorPendente').textContent = App.money(valor);
    }

    function renderAssinaturas() {
        const el = document.getElementById('listaAssinaturas');
        if (!assinaturas.length) { el.innerHTML = '<p class="empty-state">Nenhuma assinatura encontrada.</p>'; return; }
        el.innerHTML = `<div class="responsive-table"><table><thead><tr><th>Loja</th><th>Status</th><th>Teste até</th><th>Próx. cobrança</th><th>Valor</th><th>Pendente</th><th>Ações</th></tr></thead><tbody>${assinaturas.map(a => `
            <tr>
                <td><strong>${App.escapeHtml(a.nome_loja || '')}</strong><br><small>${App.escapeHtml(a.responsavel || '')}</small></td>
                <td>${statusBadge(a.status)}</td>
                <td>${fmtData(a.fim_teste)}<br><small>${Number(a.dias_restantes || 0)} dia(s)</small></td>
                <td>${fmtData(a.proxima_cobranca)}</td>
                <td>${App.money(a.valor_mensal || 0)}</td>
                <td>${App.money(a.valor_pendente || 0)}</td>
                <td><div class="table-actions">
                    <button class="btn btn-sm btn-success" onclick="alterarStatus(${a.id}, 'ATIVA')"><i class="bx bx-check"></i> Ativar</button>
                    <button class="btn btn-sm btn-warning" onclick="alterarStatus(${a.id}, 'PENDENTE')"><i class="bx bx-time"></i> Pendente</button>
                    <button class="btn btn-sm btn-danger" onclick="alterarStatus(${a.id}, 'BLOQUEADA')"><i class="bx bx-lock"></i> Bloquear</button>
                </div></td>
            </tr>`).join('')}</tbody></table></div>`;
    }

    function renderCobrancas() {
        const el = document.getElementById('listaCobrancas');
        if (!cobrancas.length) { el.innerHTML = '<p class="empty-state">Nenhuma cobrança gerada.</p>'; return; }
        el.innerHTML = `<div class="responsive-table"><table><thead><tr><th>Código</th><th>Loja</th><th>Referência</th><th>Valor</th><th>Status</th><th>Vencimento</th><th>Ações</th></tr></thead><tbody>${cobrancas.map(c => `
            <tr>
                <td>${App.escapeHtml(c.codigo || '')}</td>
                <td>${App.escapeHtml(c.nome_loja || '')}</td>
                <td>${App.escapeHtml(c.mes_referencia || '')}</td>
                <td>${App.money(c.valor || 0)}</td>
                <td>${statusBadge(c.status)}</td>
                <td>${fmtData(c.vencimento)}</td>
                <td>${c.status !== 'PAGO' ? `<button class="btn btn-sm btn-success" onclick="marcarPago(${c.id})"><i class="bx bx-check-circle"></i> Pago</button>` : '-'}</td>
            </tr>`).join('')}</tbody></table></div>`;
    }

    window.alterarStatus = async (id, status) => {
        try {
            const { value: formValues } = await Swal.fire({
                title: `Alterar para ${status}`,
                html: `<input id="swalValor" class="swal2-input" placeholder="Valor mensal opcional"><input id="swalData" class="swal2-input" type="date" placeholder="Próxima cobrança"><textarea id="swalObs" class="swal2-textarea" placeholder="Observação"></textarea>`,
                focusConfirm: false,
                showCancelButton: true,
                confirmButtonText: 'Salvar',
                cancelButtonText: 'Cancelar',
                preConfirm: () => ({ valor_mensal: document.getElementById('swalValor').value, proxima_cobranca: document.getElementById('swalData').value, observacao: document.getElementById('swalObs').value })
            });
            if (!formValues) return;
            await App.api(`/assinaturas/${id}/status`, { method: 'POST', body: JSON.stringify({ status, ...formValues }) });
            App.toast('success', 'Assinatura atualizada.');
            await carregar();
        } catch (err) { App.toast('error', err.message); }
    };

    window.marcarPago = async (id) => {
        try {
            const ok = await App.confirmDialog({ title: 'Marcar cobrança como paga?', text: 'O catálogo será ativado e a próxima cobrança será em 1 mês.', confirmText: 'Marcar como paga', icon: 'question' });
            if (!ok.isConfirmed) return;
            await App.api(`/assinaturas/cobrancas/${id}/pagar`, { method: 'POST', body: JSON.stringify({}) });
            App.toast('success', 'Cobrança paga.');
            await carregar();
        } catch (err) { App.toast('error', err.message); }
    };

    async function carregar() {
        assinaturas = await App.api('/assinaturas/admin');
        cobrancas = await App.api('/assinaturas/cobrancas');
        renderStats(); renderAssinaturas(); renderCobrancas();
    }

    document.getElementById('btnGerarCobrancas')?.addEventListener('click', async () => {
        try {
            const { value } = await Swal.fire({ title: 'Gerar cobranças vencidas', input: 'text', inputLabel: 'Valor mensal opcional', inputPlaceholder: 'Ex.: 29,90', showCancelButton: true, confirmButtonText: 'Gerar' });
            if (value === undefined) return;
            const r = await App.api('/assinaturas/gerar-cobrancas', { method: 'POST', body: JSON.stringify({ valor_mensal: value }) });
            App.toast('success', r.mensagem);
            await carregar();
        } catch (err) { App.toast('error', err.message); }
    });
    document.getElementById('btnSincronizar')?.addEventListener('click', async () => {
        try { const r = await App.api('/assinaturas/sincronizar-status', { method: 'POST', body: JSON.stringify({}) }); App.toast('success', r.mensagem); await carregar(); } catch (err) { App.toast('error', err.message); }
    });

    try { await carregar(); } catch (err) { App.toast('error', err.message); }
});
