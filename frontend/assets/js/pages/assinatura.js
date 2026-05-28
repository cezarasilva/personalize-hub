document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage({ parceiroOnly: true });
    App.renderSidebar('assinatura');

    function fmtData(data) { return data ? new Date(data).toLocaleDateString('pt-BR') : '-'; }

    window.enviarComprovante = async (id) => {
        try {
            const { value: url } = await Swal.fire({ title: 'Enviar comprovante', input: 'url', inputLabel: 'URL do comprovante', inputPlaceholder: 'Cole um link da imagem/PDF do comprovante', showCancelButton: true, confirmButtonText: 'Enviar' });
            if (!url) return;
            const form = new FormData();
            form.append('comprovante_url', url);
            await fetch(`${App.API_BASE}/assinaturas/cobrancas/${id}/comprovante`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, body: form }).then(async r => { if(!r.ok){ const e=await r.json().catch(()=>({erro:'Erro'})); throw new Error(e.erro||'Erro'); } return r.json(); });
            App.toast('success', 'Comprovante enviado.');
            location.reload();
        } catch (err) { App.toast('error', err.message); }
    };

    try {
        const pagamentoConfig = await App.api('/assinaturas/pagamento-config').catch(() => ({}));
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
            `<div class="responsive-table"><table><thead><tr><th>Código</th><th>Mês</th><th>Valor</th><th>Status</th><th>Vencimento</th><th>Pagamento</th></tr></thead><tbody>${cobrancas.map(c => {
                const pix = c.pix_copia_cola || pagamentoConfig.chave_pix || '';
                const link = c.link_pagamento || pagamentoConfig.link_pagamento_padrao || '';
                return `<tr><td>${App.escapeHtml(c.codigo || '')}</td><td>${App.escapeHtml(c.mes_referencia || '')}</td><td>${App.money(c.valor || 0)}</td><td>${App.badgeStatus(c.status)}</td><td>${fmtData(c.vencimento)}</td><td><div class="table-actions">${pix ? `<button class="btn btn-sm btn-secondary" onclick="App.copyText('${App.escapeHtml(pix).replace(/'/g, "\'")}')"><i class="bx bx-copy"></i> Copiar Pix</button>` : ''}${link ? `<a class="btn btn-sm btn-primary" href="${link}" target="_blank"><i class="bx bx-link-external"></i> Pagar</a>` : ''}<button class="btn btn-sm btn-success" onclick="enviarComprovante(${c.id})"><i class="bx bx-upload"></i> Comprovante</button></div></td></tr>`;
            }).join('')}</tbody></table></div>`;
    } catch (err) { App.toast('error', err.message); }
});
