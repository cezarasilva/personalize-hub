document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage();
    App.renderSidebar('catalogo-pedidos');

    let pedidos = [];
    let modoLista = false;
    const STATUS = ['NOVO','EM_ATENDIMENTO','ORCADO','AGUARDANDO_CLIENTE','FECHADO','PERDIDO','CANCELADO'];
    const STATUS_LABEL = {
        NOVO: 'Novos', EM_ATENDIMENTO: 'Em atendimento', ORCADO: 'Orçados',
        AGUARDANDO_CLIENTE: 'Aguardando cliente', FECHADO: 'Fechados', PERDIDO: 'Perdidos', CANCELADO: 'Cancelados'
    };

    function statusOptions(statusAtual) {
        return STATUS.map(s => `<option value="${s}" ${s === statusAtual ? 'selected' : ''}>${(STATUS_LABEL[s] || s).toUpperCase()}</option>`).join('');
    }

    function origemLead(p) {
        return p.lead_origem || (p.origem_produto === 'FOOTER' ? 'FOOTER' : p.origem_produto === 'PERSONALIZADO' ? 'PERSONALIZADO' : 'CARRINHO');
    }

    function itensPedido(p) {
        const itens = Array.isArray(p.itens) ? p.itens : [];
        if (itens.length) {
            return itens.map(i => `<li>${App.escapeHtml(i.quantidade || 1)}x ${App.escapeHtml(i.produto_nome || '')}${i.variacao ? ' - ' + App.escapeHtml(i.variacao) : ''} <strong>${App.money(i.valor_total || 0)}</strong></li>`).join('');
        }
        return `<li>${App.escapeHtml(p.produto_nome_snapshot || p.assunto_lead || 'Contato')}</li>`;
    }

    function cardPedido(p, compact=false) {
        const whats = String(p.cliente_whatsapp || '').replace(/\D/g, '');
        const origem = origemLead(p);
        const msg = encodeURIComponent(`Olá ${p.cliente_nome || ''}! Recebemos seu contato pelo catálogo. Código: ${p.codigo || ''}.`);
        const prioridade = p.prioridade || 'NORMAL';
        const proximo = p.proximo_contato ? new Date(p.proximo_contato).toLocaleDateString('pt-BR') : '';
        return `
            <article class="crm-lead-card prioridade-${prioridade.toLowerCase()}">
                <div class="crm-card-head">
                    <strong>${App.escapeHtml(p.codigo || 'Lead')}</strong>
                    <span class="badge ${origem === 'FOOTER' ? 'badge-blue' : origem === 'PERSONALIZADO' ? 'badge-yellow' : 'badge-green'}">${origem === 'FOOTER' ? 'Footer' : origem === 'PERSONALIZADO' ? 'Personalizado' : 'Catálogo'}</span>
                </div>
                <p class="crm-card-meta">${App.escapeHtml(p.nome_loja || 'Catálogo admin')} • ${new Date(p.criado_em).toLocaleString('pt-BR')}</p>
                <div class="crm-client"><strong>${App.escapeHtml(p.cliente_nome || 'Cliente')}</strong><span>${App.escapeHtml(p.cliente_whatsapp || '')}</span></div>
                <ul class="lead-items-list">${itensPedido(p)}</ul>
                <div class="crm-card-total"><span>Subtotal</span><strong>${App.money(p.subtotal || p.valor_negociado || 0)}</strong></div>
                ${p.observacoes_internas ? `<p class="crm-note"><i class="bx bx-note"></i> ${App.escapeHtml(p.observacoes_internas)}</p>` : ''}
                ${proximo ? `<p class="crm-next"><i class="bx bx-calendar"></i> Próximo contato: ${proximo}</p>` : ''}
                <div class="crm-card-actions">
                    <select onchange="alterarStatusPedido(${p.id}, this.value)">${statusOptions(p.status)}</select>
                    ${whats ? `<a class="btn btn-success" target="_blank" href="https://wa.me/55${whats}?text=${msg}"><i class="bx bxl-whatsapp"></i> Chamar</a>` : ''}
                    <button class="btn btn-light" onclick="abrirDetalhesLead(${p.id})"><i class="bx bx-edit"></i> CRM</button>
                </div>
            </article>`;
    }

    function aplicarFiltros() {
        const st = document.getElementById('filtroStatus').value;
        const origem = document.getElementById('filtroOrigem').value;
        const termo = String(document.getElementById('buscaLead').value || '').toLowerCase();
        return pedidos.filter(p => {
            const texto = `${p.codigo||''} ${p.cliente_nome||''} ${p.cliente_whatsapp||''} ${p.produto_nome_snapshot||''} ${p.observacao||''} ${JSON.stringify(p.itens||[])}`.toLowerCase();
            return (!st || p.status === st) && (!origem || origemLead(p) === origem) && (!termo || texto.includes(termo));
        });
    }

    function renderMetricas(rows) {
        document.getElementById('crmNovos').textContent = App.number(rows.filter(p => p.status === 'NOVO').length);
        document.getElementById('crmAtendimento').textContent = App.number(rows.filter(p => ['EM_ATENDIMENTO','ORCADO','AGUARDANDO_CLIENTE'].includes(p.status)).length);
        document.getElementById('crmFechados').textContent = App.number(rows.filter(p => p.status === 'FECHADO').length);
        document.getElementById('crmValor').textContent = App.money(rows.reduce((acc,p)=>acc + Number(p.subtotal || p.valor_negociado || 0), 0));
    }

    function render() {
        const rows = aplicarFiltros();
        renderMetricas(rows);
        const kanban = document.getElementById('crmKanban');
        const lista = document.getElementById('listaPedidos');
        kanban.style.display = modoLista ? 'none' : 'grid';
        lista.style.display = modoLista ? 'grid' : 'none';
        if (!rows.length) {
            kanban.innerHTML = lista.innerHTML = '<p class="empty-state">Nenhum lead/pedido encontrado.</p>';
            return;
        }
        kanban.innerHTML = STATUS.map(status => {
            const col = rows.filter(p => p.status === status);
            return `<div class="crm-column" data-status="${status}">
                <div class="crm-column-title"><span>${STATUS_LABEL[status]}</span><strong>${col.length}</strong></div>
                <div class="crm-column-body">${col.map(p => cardPedido(p, true)).join('') || '<p class="empty-state small">Vazio</p>'}</div>
            </div>`;
        }).join('');
        lista.innerHTML = rows.map(p => cardPedido(p)).join('');
    }

    window.alterarStatusPedido = async (id, status) => {
        try {
            await App.api(`/catalogo-pedidos/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
            App.toast('success', 'Status atualizado.');
            await carregar();
        } catch (err) { App.toast('error', err.message); }
    };

    window.abrirDetalhesLead = async (id) => {
        const p = pedidos.find(x => x.id === id);
        if (!p) return;
        const { value } = await Swal.fire({
            title: `CRM ${p.codigo || ''}`,
            width: 720,
            html: `
                <div class="swal-crm-grid">
                    <label>Status<select id="crmStatus">${statusOptions(p.status)}</select></label>
                    <label>Prioridade<select id="crmPrioridade"><option ${p.prioridade==='BAIXA'?'selected':''}>BAIXA</option><option ${!p.prioridade||p.prioridade==='NORMAL'?'selected':''}>NORMAL</option><option ${p.prioridade==='ALTA'?'selected':''}>ALTA</option><option ${p.prioridade==='URGENTE'?'selected':''}>URGENTE</option></select></label>
                    <label>Canal<select id="crmCanal"><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">E-mail</option><option value="TELEFONE">Telefone</option><option value="PRESENCIAL">Presencial</option></select></label>
                    <label>Valor negociado<input id="crmValorNegociado" value="${p.valor_negociado || p.subtotal || 0}" inputmode="decimal"></label>
                    <label>Próximo contato<input id="crmProximo" type="date" value="${p.proximo_contato ? String(p.proximo_contato).slice(0,10) : ''}"></label>
                    <label>Motivo perda/recusa<input id="crmMotivo" value="${App.escapeHtml(p.motivo_perda || '')}"></label>
                    <label style="grid-column:1/-1;">Observações internas<textarea id="crmObs">${App.escapeHtml(p.observacoes_internas || '')}</textarea></label>
                </div>`,
            showCancelButton: true,
            confirmButtonText: 'Salvar CRM',
            cancelButtonText: 'Cancelar',
            preConfirm: () => ({
                status: document.getElementById('crmStatus').value,
                prioridade: document.getElementById('crmPrioridade').value,
                canal_atendimento: document.getElementById('crmCanal').value,
                valor_negociado: document.getElementById('crmValorNegociado').value,
                proximo_contato: document.getElementById('crmProximo').value,
                motivo_perda: document.getElementById('crmMotivo').value,
                observacoes_internas: document.getElementById('crmObs').value
            })
        });
        if (!value) return;
        await App.api(`/catalogo-pedidos/${id}/crm`, { method: 'PATCH', body: JSON.stringify(value) });
        App.toast('success', 'Lead atualizado.');
        await carregar();
    };

    async function carregar() { pedidos = await App.api('/catalogo-pedidos'); render(); }

    ['filtroStatus','filtroOrigem','buscaLead'].forEach(id => document.getElementById(id).addEventListener(id === 'buscaLead' ? 'input' : 'change', render));
    document.getElementById('btnModoLista').addEventListener('click', () => { modoLista = !modoLista; render(); });
    try { await carregar(); } catch (err) { App.toast('error', err.message); }
});
