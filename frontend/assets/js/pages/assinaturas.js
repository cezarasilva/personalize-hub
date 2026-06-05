document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('assinaturas');

    let assinaturas = [];
    let cobrancas = [];
    let pagamentoConfig = {};

    function statusBadge(status) { return App.badgeStatus(status || ''); }
    function fmtData(data) { return data ? new Date(data).toLocaleDateString('pt-BR') : '-'; }

    async function carregarPagamentoConfig() {
        try {
            pagamentoConfig = await App.api('/assinaturas/pagamento-config');
            const form = document.getElementById('formPagamentoConfig');
            if (form) {
                ['nome_recebedor','documento_recebedor','tipo_chave_pix','chave_pix','banco','whatsapp_cobranca','link_pagamento_padrao','instrucoes_pagamento'].forEach(k => {
                    if (form.elements[k]) form.elements[k].value = pagamentoConfig[k] || '';
                });
            }
        } catch (_) {}
    }

    function whatsappCobranca(c) {
        const tel = String(pagamentoConfig.whatsapp_cobranca || '').replace(/\D/g, '');
        if (!tel) return '';
        const msg = `Olá! Segue cobrança da assinatura do catálogo ${c.codigo || ''}. Valor: ${App.money(c.valor || 0)}. Vencimento: ${fmtData(c.vencimento)}. Pix: ${pagamentoConfig.chave_pix || c.pix_copia_cola || ''}`;
        return `https://wa.me/${tel}?text=${encodeURIComponent(msg)}`;
    }

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
        el.innerHTML = `<div class="responsive-table"><table>
            <thead><tr><th>Código</th><th>Loja</th><th>Referência</th><th>Valor</th><th>Status</th><th>Vencimento</th><th>PIX Auto</th><th>Ações</th></tr></thead>
            <tbody>${cobrancas.map(c => {
                const pixBtn = c.status !== 'PAGO'
                    ? `<button class="btn btn-sm btn-primary" onclick="gerarPixAuto(${c.id})">
                           <i class="bx bx-qr"></i> ${c.mp_payment_id ? 'Ver QR' : 'Gerar Pix'}
                       </button>`
                    : `<span class="badge badge-green"><i class="bx bx-check"></i> Pago ${c.mp_payment_id ? 'MP' : ''}</span>`;
                return `<tr>
                    <td>${App.escapeHtml(c.codigo||'')}</td>
                    <td>${App.escapeHtml(c.nome_loja||'')}</td>
                    <td>${App.escapeHtml(c.mes_referencia||'')}</td>
                    <td>${App.money(c.valor||0)}</td>
                    <td>${statusBadge(c.status)}</td>
                    <td>${fmtData(c.vencimento)}</td>
                    <td>${pixBtn}</td>
                    <td><div class="table-actions">
                        ${whatsappCobranca(c) ? `<a class="btn btn-sm btn-success" href="${whatsappCobranca(c)}" target="_blank"><i class="bx bxl-whatsapp"></i></a>` : ''}
                        ${c.status !== 'PAGO' ? `<button class="btn btn-sm btn-light" onclick="marcarPago(${c.id})"><i class="bx bx-check-circle"></i> Manual</button>` : ''}
                        ${c.status === 'PAGO' ? `<button class="btn btn-sm btn-light" onclick="verRecibo(${c.id})"><i class="bx bx-receipt"></i> Recibo</button>` : ''}
                    </div></td>
                </tr>`;
            }).join('')}</tbody></table></div>`;
    }

    // ---- PIX Automático (Mercado Pago) ----
    window.gerarPixAuto = async (cobId) => {
        Swal.fire({ title: 'Aguarde...', text: 'Gerando QR Code Pix', allowOutsideClick: false, showConfirmButton: false, didOpen: () => Swal.showLoading() });
        try {
            const pix = await App.api(`/assinaturas/cobrancas/${cobId}/gerar-pix-mp`, { method: 'POST' });
            Swal.close();
            exibirQrCode(pix, cobId);
        } catch (err) {
            Swal.fire('Erro', err.message, 'error');
        }
    };

    function exibirQrCode(pix, cobId) {
        const imgHtml = pix.qr_code_base64
            ? `<img src="data:image/png;base64,${pix.qr_code_base64}" style="width:200px;height:200px;margin:0 auto 14px;display:block;border-radius:12px;border:2px solid #e2e8f0;">`
            : '<p style="color:#94a3b8;font-size:13px;">QR Code não disponível</p>';

        Swal.fire({
            title: '<i class="bx bx-qr-scan"></i> PIX — Mercado Pago',
            html: `
                <div style="text-align:center;">
                    ${imgHtml}
                    <p style="font-size:12px;color:#64748b;margin-bottom:10px;">Copie o código abaixo ou escaneie o QR Code:</p>
                    <input id="swalPixCode" type="text" readonly value="${App.escapeHtml(pix.qr_code||'')}"
                        style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:11px;text-align:center;cursor:pointer;"
                        onclick="this.select();">
                    ${pix.ticket_url ? `<a href="${pix.ticket_url}" target="_blank" style="display:block;margin-top:10px;font-size:13px;font-weight:700;color:#6366f1;">Abrir no Mercado Pago ↗</a>` : ''}
                    <p style="font-size:11px;color:#10b981;margin-top:12px;font-weight:700;">✓ Confirmação automática após o pagamento</p>
                </div>`,
            confirmButtonText: '<i class="bx bx-copy"></i> Copiar código PIX',
            showCancelButton: true,
            cancelButtonText: 'Fechar'
        }).then(r => {
            if (r.isConfirmed && pix.qr_code) App.copyText(pix.qr_code, 'Código PIX copiado!');
        });
    }

    // ---- Recibo ----
    window.verRecibo = async (cobId) => {
        try {
            const c = await App.api(`/assinaturas/cobrancas/${cobId}/recibo`);
            Swal.fire({
                title: 'Recibo de Pagamento',
                html: `<div style="text-align:left;font-size:13px;line-height:1.8;">
                    <p><strong>Código:</strong> ${App.escapeHtml(c.codigo||'')}</p>
                    <p><strong>Loja:</strong> ${App.escapeHtml(c.nome_loja||'')}</p>
                    <p><strong>Referência:</strong> ${App.escapeHtml(c.mes_referencia||'')}</p>
                    <p><strong>Valor:</strong> <strong style="color:#10b981;">${App.money(c.valor||0)}</strong></p>
                    <p><strong>Data pagamento:</strong> ${c.pago_fmt || '-'}</p>
                    <p><strong>Método:</strong> ${c.mp_payment_id ? 'Pix Mercado Pago' : 'Manual'}</p>
                    ${c.mp_payment_id ? `<p><strong>ID Mercado Pago:</strong> ${App.escapeHtml(c.mp_payment_id)}</p>` : ''}
                </div>`,
                icon: 'success',
                confirmButtonText: 'Fechar'
            });
        } catch (err) { App.toast('error', err.message); }
    };

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
        await carregarPagamentoConfig();
        assinaturas = await App.api('/assinaturas/admin');
        cobrancas = await App.api('/assinaturas/cobrancas');
        renderStats(); renderAssinaturas(); renderCobrancas();
    }

    document.getElementById('btnGerarCobrancas')?.addEventListener('click', async () => {
        try {
            // Usa o valor já configurado em cada assinatura; não pede input
            const { isConfirmed } = await Swal.fire({
                title: 'Gerar cobranças vencidas',
                text: 'O sistema usará o valor mensal já configurado em cada assinatura. Confirmar?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Gerar cobranças',
                cancelButtonText: 'Cancelar'
            });
            if (!isConfirmed) return;
            const r = await App.api('/assinaturas/gerar-cobrancas', { method: 'POST', body: JSON.stringify({}) });
            App.toast('success', r.mensagem);
            await carregar();
        } catch (err) { App.toast('error', err.message); }
    });
    document.getElementById('formPagamentoConfig')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const form = e.currentTarget;
            const payload = Object.fromEntries(new FormData(form).entries());
            const r = await App.api('/assinaturas/pagamento-config', { method: 'PUT', body: JSON.stringify(payload) });
            App.toast('success', r.mensagem || 'Configuração salva.');
            await carregarPagamentoConfig();
        } catch (err) { App.toast('error', err.message); }
    });

    document.getElementById('btnSincronizar')?.addEventListener('click', async () => {
        try { const r = await App.api('/assinaturas/sincronizar-status', { method: 'POST', body: JSON.stringify({}) }); App.toast('success', r.mensagem); await carregar(); } catch (err) { App.toast('error', err.message); }
    });

    try { await carregar(); } catch (err) { App.toast('error', err.message); }
});
