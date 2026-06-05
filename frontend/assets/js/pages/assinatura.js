document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage({ parceiroOnly: true });
    App.renderSidebar('assinatura');

    function fmtData(d) { return d ? new Date(d).toLocaleDateString('pt-BR') : '-'; }
    let pollingTimer = null;

    // ---- QR Code Pix (exibição para o parceiro) ----
    window.verPixCobranca = async (cobId) => {
        try {
            const c = await App.api(`/assinaturas/cobrancas/${cobId}/status-mp`);
            if (!c.mp_qr_code) { App.toast('warning', 'QR Code Pix ainda não foi gerado pelo administrador.'); return; }

            const imgHtml = c.mp_qr_code_base64
                ? `<img src="data:image/png;base64,${c.mp_qr_code_base64}" style="width:200px;height:200px;margin:0 auto 14px;display:block;border-radius:12px;border:2px solid #e2e8f0;">`
                : '';

            Swal.fire({
                title: 'Pagar via PIX',
                html: `<div style="text-align:center;">
                    ${imgHtml}
                    <p style="font-size:12px;color:#64748b;margin-bottom:8px;">Escaneie ou copie o código:</p>
                    <input type="text" readonly value="${App.escapeHtml(c.mp_qr_code)}"
                        style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:11px;cursor:pointer;"
                        onclick="this.select();">
                    ${c.mp_ticket_url ? `<a href="${c.mp_ticket_url}" target="_blank" style="display:block;margin-top:10px;font-size:13px;font-weight:700;color:#6366f1;">Pagar no Mercado Pago ↗</a>` : ''}
                    <p style="font-size:11px;color:#10b981;margin-top:12px;font-weight:700;">✓ Após o pagamento, seu catálogo é liberado automaticamente</p>
                </div>`,
                confirmButtonText: '<i class="bx bx-copy"></i> Copiar PIX',
                showCancelButton: true,
                cancelButtonText: 'Fechar'
            }).then(r => {
                if (r.isConfirmed) App.copyText(c.mp_qr_code, 'Código PIX copiado!');
                // Inicia polling para confirmar pagamento
                iniciarPolling(cobId);
            });
        } catch (err) { App.toast('error', err.message); }
    };

    // Polling: verifica a cada 10s se a cobrança foi paga
    function iniciarPolling(cobId) {
        clearInterval(pollingTimer);
        pollingTimer = setInterval(async () => {
            try {
                const c = await App.api(`/assinaturas/cobrancas/${cobId}/status-mp`);
                if (c.status === 'PAGO') {
                    clearInterval(pollingTimer);
                    Swal.close();
                    await Swal.fire({ icon: 'success', title: 'Pagamento confirmado!', text: 'Seu catálogo foi ativado com sucesso.', confirmButtonText: 'Ótimo!' });
                    location.reload();
                }
            } catch { clearInterval(pollingTimer); }
        }, 10000);
    }

    window.verRecibo = async (cobId) => {
        try {
            const c = await App.api(`/assinaturas/cobrancas/${cobId}/recibo`);
            Swal.fire({
                title: 'Recibo de Pagamento',
                html: `<div style="text-align:left;font-size:13px;line-height:1.8;">
                    <p><strong>Código:</strong> ${App.escapeHtml(c.codigo||'')}</p>
                    <p><strong>Referência:</strong> ${App.escapeHtml(c.mes_referencia||'')}</p>
                    <p><strong>Valor:</strong> <strong style="color:#10b981;">${App.money(c.valor||0)}</strong></p>
                    <p><strong>Pago em:</strong> ${c.pago_fmt||'-'}</p>
                    <p><strong>Método:</strong> ${c.mp_payment_id ? 'Pix Mercado Pago' : 'Pix Manual'}</p>
                </div>`,
                icon: 'success', confirmButtonText: 'Fechar'
            });
        } catch (err) { App.toast('error', err.message); }
    };

    window.enviarComprovante = async (id) => {
        try {
            const { value: url } = await Swal.fire({ title: 'Enviar comprovante', input: 'url', inputLabel: 'URL do comprovante', inputPlaceholder: 'Cole o link da imagem/PDF', showCancelButton: true, confirmButtonText: 'Enviar' });
            if (!url) return;
            const form = new FormData();
            form.append('comprovante_url', url);
            await fetch(`${App.API_BASE}/assinaturas/cobrancas/${id}/comprovante`, { method: 'POST', headers: { Authorization: `Bearer ${App.token()}` }, body: form })
                .then(async r => { if (!r.ok) { const e = await r.json().catch(() => ({ erro: 'Erro' })); throw new Error(e.erro); } return r.json(); });
            App.toast('success', 'Comprovante enviado.');
            location.reload();
        } catch (err) { App.toast('error', err.message); }
    };

    try {
        const dados = await App.api('/assinaturas/minha');
        const a = dados.assinatura || {};

        document.getElementById('assinaturaStatus').innerHTML = App.badgeStatus(a.status || '-');
        document.getElementById('assinaturaDias').textContent  = Number(a.dias_restantes || 0);
        document.getElementById('assinaturaValor').textContent = App.money(a.valor_mensal || 0);

        const statusColor = ['BLOQUEADA','CANCELADA','PENDENTE'].includes(a.status)
            ? 'var(--danger)' : 'var(--success)';
        const statusMsg = a.status === 'BLOQUEADA'
            ? '⚠️ Catálogo bloqueado. Efetue o pagamento para reativar.'
            : a.status === 'PENDENTE'
            ? '⏳ Pagamento pendente. Catálogo em revisão.'
            : '✓ Catálogo ativo e disponível para seus clientes.';

        document.getElementById('detalhesAssinatura').innerHTML = `
            <div class="assinatura-panel">
                <p style="font-weight:700;color:${statusColor};margin-bottom:10px;">${statusMsg}</p>
                <p><strong>Plano:</strong> ${App.escapeHtml(a.plano || 'CATALOGO_BASICO')}</p>
                <p><strong>Início do teste:</strong> ${fmtData(a.inicio_teste)}</p>
                <p><strong>Fim do teste:</strong> ${fmtData(a.fim_teste)}</p>
                <p><strong>Próxima cobrança:</strong> ${fmtData(a.proxima_cobranca)}</p>
            </div>`;

        const cobrancas = dados.cobrancas || [];
        document.getElementById('minhasCobrancas').innerHTML = !cobrancas.length
            ? '<p class="empty-state">Nenhuma cobrança encontrada.</p>'
            : `<div class="responsive-table"><table>
                <thead><tr><th>Código</th><th>Mês</th><th>Valor</th><th>Status</th><th>Vencimento</th><th>Pagamento</th></tr></thead>
                <tbody>${cobrancas.map(c => {
                    const pagoFmt = c.status === 'PAGO'
                        ? `<span class="badge badge-green"><i class="bx bx-check"></i> Pago</span>`
                        : App.badgeStatus(c.status);
                    const acoes = c.status !== 'PAGO' ? `
                        <div class="table-actions">
                            ${c.mp_qr_code ? `<button class="btn btn-sm btn-primary" onclick="verPixCobranca(${c.id})"><i class="bx bx-qr-scan"></i> Pagar PIX</button>` : ''}
                            <button class="btn btn-sm btn-light" onclick="enviarComprovante(${c.id})"><i class="bx bx-upload"></i> Comprovante</button>
                        </div>` : `<button class="btn btn-sm btn-light" onclick="verRecibo(${c.id})"><i class="bx bx-receipt"></i> Recibo</button>`;
                    return `<tr>
                        <td>${App.escapeHtml(c.codigo||'')}</td>
                        <td>${App.escapeHtml(c.mes_referencia||'')}</td>
                        <td>${App.money(c.valor||0)}</td>
                        <td>${pagoFmt}</td>
                        <td>${fmtData(c.vencimento)}</td>
                        <td>${acoes}</td>
                    </tr>`;
                }).join('')}</tbody></table></div>`;
    } catch (err) { App.toast('error', err.message); }
});
