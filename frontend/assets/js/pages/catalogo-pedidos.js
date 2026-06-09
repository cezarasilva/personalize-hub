document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage();
    App.renderSidebar('catalogo-pedidos');

    // =========================================================
    // CONSTANTES
    // =========================================================
    const STATUS = ['NOVO','EM_ATENDIMENTO','ORCADO','AGUARDANDO_CLIENTE','FECHADO','CANCELADO'];
    const STATUS_LABEL = {
        NOVO:'Novos', EM_ATENDIMENTO:'Em atendimento', ORCADO:'Orçados',
        AGUARDANDO_CLIENTE:'Aguardando cliente', FECHADO:'Fechados', CANCELADO:'Cancelados'
    };
    const STATUS_COR = {
        NOVO:'badge-blue', EM_ATENDIMENTO:'badge-yellow', ORCADO:'badge-info',
        AGUARDANDO_CLIENTE:'badge-yellow', FECHADO:'badge-green', CANCELADO:'badge-red'
    };
    const FUNIL_BAR_COR = {
        NOVO:'', EM_ATENDIMENTO:'', ORCADO:'',
        AGUARDANDO_CLIENTE:'warning', FECHADO:'success', CANCELADO:'danger'
    };
    const esc = App.escapeHtml;

    // =========================================================
    // ESTADO
    // =========================================================
    let pedidos   = [];
    let usuarios  = [];
    let viewAtiva = 'kanban';
    let drawerLeadId = null;

    // =========================================================
    // HELPERS
    // =========================================================
    function origemLead(p) {
        return p.lead_origem || (p.origem_produto === 'FOOTER' ? 'FOOTER' : p.origem_produto === 'PERSONALIZADO' ? 'PERSONALIZADO' : 'CARRINHO');
    }
    function itensPedido(p) {
        const itens = Array.isArray(p.itens) ? p.itens : [];
        if (itens.length) return itens.map(i =>
            `<li>${esc(String(i.quantidade||1))}x ${esc(i.produto_nome||'')} ${i.variacao ? '- '+esc(i.variacao) : ''} <strong>${App.money(i.valor_total||0)}</strong></li>`
        ).join('');
        return `<li>${esc(p.produto_nome_snapshot || p.assunto_lead || 'Contato')}</li>`;
    }
    function statusOptions(atual) {
        return STATUS.map(s => `<option value="${s}" ${s===atual?'selected':''}>${STATUS_LABEL[s]||s}</option>`).join('');
    }
    function aplicarFiltros() {
        const st     = document.getElementById('filtroStatus')?.value || '';
        const origem = document.getElementById('filtroOrigem')?.value || '';
        const termo  = (document.getElementById('buscaLead')?.value || '').toLowerCase();
        return pedidos.filter(p => {
            const txt = `${p.codigo||''} ${p.cliente_nome||''} ${p.cliente_whatsapp||''} ${p.produto_nome_snapshot||''} ${JSON.stringify(p.itens||[])}`.toLowerCase();
            return (!st || p.status === st) && (!origem || origemLead(p) === origem) && (!termo || txt.includes(termo));
        });
    }

    async function avancarStatusSeLead(id, novoStatus) {
        try {
            await App.api(`/catalogo-pedidos/${id}/status`, { method:'PATCH', body: JSON.stringify({ status: novoStatus }) });
            const lead = pedidos.find(x => x.id === id);
            if (lead) lead.status = novoStatus;
        } catch { /* silencioso */ }
    }

    // =========================================================
    // CARD DO LEAD
    // =========================================================
    function cardLead(p) {
        const whats   = String(p.cliente_whatsapp || '').replace(/\D/g, '');
        const origem  = origemLead(p);
        const msg     = encodeURIComponent(`Olá ${p.cliente_nome||''}! Código: ${p.codigo||''}.`);
        const prio    = p.prioridade || 'NORMAL';
        const proximo = p.proximo_contato ? new Date(p.proximo_contato).toLocaleDateString('pt-BR') : '';
        const respNome = p.responsavel_nome ? `<span class="crm-responsavel-badge"><i class="bx bx-user"></i>${esc(p.responsavel_nome)}</span>` : '';
        return `
        <article class="crm-lead-card prioridade-${prio.toLowerCase()}">
            <div class="crm-card-head">
                <strong>${esc(p.codigo||'Lead')}</strong>
                <span class="badge ${origem==='FOOTER'?'badge-blue':origem==='PERSONALIZADO'?'badge-yellow':'badge-green'}">${origem==='FOOTER'?'Footer':origem==='PERSONALIZADO'?'Personalizado':'Catálogo'}</span>
            </div>
            <p class="crm-card-meta">${esc(p.nome_loja||'Admin')} • ${new Date(p.criado_em).toLocaleString('pt-BR')}</p>
            <div class="crm-client">
                <strong>${esc(p.cliente_nome||'Cliente')}</strong>
                <span>${esc(p.cliente_whatsapp||'')}</span>
            </div>
            ${respNome}
            <ul class="lead-items-list">${itensPedido(p)}</ul>
            <div class="crm-card-total">
                <span>Estimado</span>
                <strong>${App.money(p.subtotal||p.valor_negociado||0)}</strong>
            </div>
            ${p.observacoes_internas ? `<p class="crm-note"><i class="bx bx-note"></i> ${esc(p.observacoes_internas)}</p>` : ''}
            ${proximo ? `<p class="crm-next"><i class="bx bx-calendar"></i> Próx. contato: ${proximo}</p>` : ''}
            <div class="crm-card-actions">
                <select onchange="alterarStatusPedido(${p.id},this.value)">${statusOptions(p.status)}</select>
                ${whats ? `<button class="btn btn-success" onclick="abrirWhatsApp(${p.id},'${whats}','${encodeURIComponent(msg)}')"><i class="bx bxl-whatsapp"></i></button>` : ''}
                <button class="btn btn-light" onclick="abrirDrawerLead(${p.id})"><i class="bx bx-edit"></i> CRM</button>
            </div>
        </article>`;
    }

    // =========================================================
    // MÉTRICAS
    // =========================================================
    function renderMetricas(rows) {
        document.getElementById('crmNovos').textContent       = App.number(rows.filter(p=>p.status==='NOVO').length);
        document.getElementById('crmAtendimento').textContent = App.number(rows.filter(p=>['EM_ATENDIMENTO','ORCADO','AGUARDANDO_CLIENTE'].includes(p.status)).length);
        document.getElementById('crmFechados').textContent    = App.number(rows.filter(p=>p.status==='FECHADO').length);
        document.getElementById('crmValor').textContent       = App.money(rows.reduce((s,p)=>s+Number(p.subtotal||p.valor_negociado||0),0));
    }

    // =========================================================
    // RENDER PRINCIPAL
    // =========================================================
    function render() {
        const rows = aplicarFiltros();
        renderMetricas(rows);
        ['viewKanban','viewLista','viewFunil','viewRelatorio'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        document.querySelectorAll('.crm-view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === viewAtiva));
        const view = document.getElementById('view' + viewAtiva.charAt(0).toUpperCase() + viewAtiva.slice(1));
        if (view) view.style.display = '';

        if (viewAtiva === 'kanban') renderKanban(rows);
        else if (viewAtiva === 'lista') renderLista(rows);
        else if (viewAtiva === 'funil') renderFunil(rows);
        else if (viewAtiva === 'relatorio') renderRelatorio(rows);
    }

    function renderKanban(rows) {
        const el = document.getElementById('viewKanban');
        if (!el) return;
        el.innerHTML = STATUS.map(st => {
            const col = rows.filter(p => p.status === st);
            return `<div class="crm-column" data-status="${st}">
                <div class="crm-column-title">
                    <span>${STATUS_LABEL[st]}</span>
                    <strong>${col.length}</strong>
                </div>
                <div class="crm-column-body">
                    ${col.map(cardLead).join('') || '<p class="empty-state" style="font-size:12px;">Vazio</p>'}
                </div>
            </div>`;
        }).join('');
    }

    function renderLista(rows) {
        const el = document.getElementById('viewLista');
        if (!el) return;
        el.innerHTML = rows.length
            ? rows.map(cardLead).join('')
            : '<p class="empty-state">Nenhum lead encontrado.</p>';
    }

    // =========================================================
    // FUNIL
    // =========================================================
    function renderFunil(rows) {
        const total    = rows.length || 1;
        const fechados  = rows.filter(p => p.status === 'FECHADO').length;
        const cancelados = rows.filter(p => p.status === 'CANCELADO').length;
        const taxaConv  = rows.length ? Math.round(fechados / rows.length * 100) : 0;
        const ticketMed = fechados ? rows.filter(p=>p.status==='FECHADO').reduce((s,p)=>s+Number(p.subtotal||p.valor_negociado||0),0) / fechados : 0;

        document.getElementById('funilMetrics').innerHTML = `
            <div class="crm-conv-metric">
                <strong>${taxaConv}%</strong>
                <span>Taxa de conversão</span>
            </div>
            <div class="crm-conv-metric">
                <strong>${App.money(ticketMed)}</strong>
                <span>Ticket médio fechado</span>
            </div>
            <div class="crm-conv-metric">
                <strong>${cancelados}</strong>
                <span>Leads cancelados</span>
            </div>`;

        document.getElementById('funilBars').innerHTML = STATUS.map(st => {
            const count = rows.filter(p => p.status === st).length;
            const pct   = Math.round(count / (total || 1) * 100);
            const cor   = FUNIL_BAR_COR[st] || '';
            return `<div class="crm-funil-row">
                <span class="crm-funil-label">${STATUS_LABEL[st]}</span>
                <div class="crm-funil-bar-wrap">
                    <div class="crm-funil-bar ${cor}" style="width:${pct}%"></div>
                </div>
                <span class="crm-funil-count">${count}</span>
                <span class="crm-funil-pct">${pct}%</span>
            </div>`;
        }).join('');
    }

    // =========================================================
    // RELATÓRIO DE CONVERSÃO (por loja)
    // =========================================================
    function renderRelatorio(rows) {
        const porLoja = {};
        rows.forEach(p => {
            const k = p.nome_loja || 'Catálogo admin';
            if (!porLoja[k]) porLoja[k] = { total:0, fechados:0, cancelados:0, valor:0 };
            porLoja[k].total++;
            if (p.status === 'FECHADO') { porLoja[k].fechados++; porLoja[k].valor += Number(p.subtotal||p.valor_negociado||0); }
            if (p.status === 'CANCELADO') porLoja[k].cancelados++;
        });
        const lojas = Object.entries(porLoja).sort((a,b) => b[1].total - a[1].total);

        document.getElementById('relatorioHead').innerHTML =
            `<tr><th>Loja</th><th>Total leads</th><th>Fechados</th><th>Cancelados</th><th>Taxa conv.</th><th>Valor total</th></tr>`;
        document.getElementById('relatorioBody').innerHTML = lojas.map(([loja, d]) => {
            const taxa = d.total ? Math.round(d.fechados/d.total*100) : 0;
            return `<tr>
                <td>${esc(loja)}</td>
                <td>${d.total}</td>
                <td><span class="badge badge-green">${d.fechados}</span></td>
                <td><span class="badge badge-red">${d.cancelados}</span></td>
                <td><strong>${taxa}%</strong></td>
                <td>${App.money(d.valor)}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="6" class="empty-state">Sem dados.</td></tr>';
    }

    // =========================================================
    // AÇÕES GLOBAIS (onclick no card)
    // =========================================================
    window.alterarStatusPedido = async (id, status) => {
        try {
            await App.api(`/catalogo-pedidos/${id}/status`, { method:'PATCH', body: JSON.stringify({ status }) });
            App.toast('success','Status atualizado.');
            await adicionarHistoricoLocal(id, 'status', `Status alterado para ${STATUS_LABEL[status]||status}`);
            await carregar();
        } catch (err) { App.toast('error', err.message); }
    };

    window.abrirWhatsApp = async (id, whats, msg) => {
        const lead = pedidos.find(x => x.id === id);
        if (lead && lead.status === 'NOVO') {
            await avancarStatusSeLead(id, 'EM_ATENDIMENTO');
            await adicionarHistoricoLocal(id, 'contato', 'Contato via WhatsApp iniciado.');
            await carregar();
        }
        window.open(`https://wa.me/55${whats}?text=${msg}`, '_blank');
    };

    window.abrirDrawerLead = (id) => abrirDrawer(id);
    window.abrirDetalhesLead = (id) => abrirDrawer(id);

    // =========================================================
    // DRAWER CRM
    // =========================================================
    function abrirDrawer(id) {
        drawerLeadId = id;
        const p = pedidos.find(x => x.id === id);
        if (!p) return;
        document.getElementById('drawerCodigo').textContent  = p.codigo || 'Lead';
        document.getElementById('drawerCliente').textContent = p.cliente_nome || 'Cliente';
        document.getElementById('drawerSub').textContent     = `${p.cliente_whatsapp||''} • ${new Date(p.criado_em).toLocaleDateString('pt-BR')}`;
        renderDrawerBody(p);
        document.getElementById('crmDrawer').classList.add('active');
        document.getElementById('crmDrawerOverlay').classList.add('active');
        carregarHistoricoDrawer(id);

        // Auto-avança NOVO para EM_ATENDIMENTO ao abrir CRM
        if (p.status === 'NOVO') {
            avancarStatusSeLead(id, 'EM_ATENDIMENTO').then(() => {
                adicionarHistoricoLocal(id, 'status', 'Lead aberto no CRM — marcado como Em atendimento.');
                p.status = 'EM_ATENDIMENTO';
                // Atualiza o select dentro do drawer
                const drStatus = document.getElementById('drStatus');
                if (drStatus) drStatus.value = 'EM_ATENDIMENTO';
            });
        }
    }

    function fecharDrawer() {
        drawerLeadId = null;
        document.getElementById('crmDrawer').classList.remove('active');
        document.getElementById('crmDrawerOverlay').classList.remove('active');
    }

    function renderDrawerBody(p) {
        const usuariosResponsaveis = p.parceiro_id
            ? usuarios.filter(u => String(u.parceiro_id) === String(p.parceiro_id))
            : usuarios.filter(u => (u.perfil || '').toUpperCase() === 'ADMIN');

        const respOpts = usuariosResponsaveis.map(u =>
            `<option value="${u.id}" ${String(u.id) === String(p.responsavel_id) ? 'selected':''}>${esc(u.nome)}</option>`
        ).join('');

        const respInfo = p.parceiro_id
            ? `<small class="text-muted">Operadores da loja ${esc(p.nome_loja||'parceira')}</small>`
            : `<small class="text-muted">Administradores do sistema</small>`;

        document.getElementById('drawerBody').innerHTML = `
            <!-- Status e CRM -->
            <div>
                <div class="crm-section-title"><i class="bx bx-slider-alt"></i> Status e Atendimento</div>
                <div class="form-grid">
                    <div class="form-group">
                        <label>Status</label>
                        <select id="drStatus">${statusOptions(p.status)}</select>
                    </div>
                    <div class="form-group">
                        <label>Prioridade</label>
                        <select id="drPrioridade">
                            <option value="BAIXA"    ${p.prioridade==='BAIXA'?'selected':''}>Baixa</option>
                            <option value="NORMAL"   ${!p.prioridade||p.prioridade==='NORMAL'?'selected':''}>Normal</option>
                            <option value="ALTA"     ${p.prioridade==='ALTA'?'selected':''}>Alta</option>
                            <option value="URGENTE"  ${p.prioridade==='URGENTE'?'selected':''}>Urgente</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Canal</label>
                        <select id="drCanal">
                            <option value="WHATSAPP"  ${p.canal_atendimento==='WHATSAPP'?'selected':''}>WhatsApp</option>
                            <option value="EMAIL"     ${p.canal_atendimento==='EMAIL'?'selected':''}>E-mail</option>
                            <option value="TELEFONE"  ${p.canal_atendimento==='TELEFONE'?'selected':''}>Telefone</option>
                            <option value="PRESENCIAL"${p.canal_atendimento==='PRESENCIAL'?'selected':''}>Presencial</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Responsável pelo atendimento</label>
                        <select id="drResponsavel">
                            <option value="">Ninguém atribuído</option>
                            ${respOpts}
                        </select>
                        ${respInfo}
                    </div>
                    <div class="form-group">
                        <label>Próximo contato</label>
                        <input type="date" id="drProximo" value="${p.proximo_contato ? String(p.proximo_contato).slice(0,10) : ''}">
                    </div>
                    <div class="form-group">
                        <label>Valor negociado</label>
                        <input type="number" step="0.01" id="drValor" value="${p.valor_negociado||p.subtotal||0}">
                    </div>
                    <div class="form-group" style="grid-column:1/-1;">
                        <label>Observações internas</label>
                        <textarea id="drObs">${esc(p.observacoes_internas||'')}</textarea>
                    </div>
                    <div class="form-group" style="grid-column:1/-1;">
                        <label>Motivo de recusa / cancelamento</label>
                        <input id="drMotivo" value="${esc(p.motivo_perda||'')}">
                    </div>
                </div>
            </div>

            <!-- Ações rápidas -->
            <div>
                <div class="crm-section-title"><i class="bx bx-zap"></i> Ações rápidas</div>
                <div class="crm-actions-grid">
                    <button class="crm-action-btn contato" onclick="registrarContato(${p.id})">
                        <i class="bx bx-phone-call"></i> Registrar contato
                    </button>
                    <button class="crm-action-btn success" onclick="converterEmVenda(${p.id})">
                        <i class="bx bx-dollar-circle"></i> Converter em venda
                    </button>
                    <button class="crm-action-btn" onclick="marcarComoOrcado(${p.id})">
                        <i class="bx bx-file"></i> Marcar como orçado
                    </button>
                    <button class="crm-action-btn" onclick="marcarComoNaoAtendido(${p.id})">
                        <i class="bx bx-reset"></i> Marcar como não atendido
                    </button>
                </div>
            </div>

            <!-- Itens do pedido -->
            <div>
                <div class="crm-section-title"><i class="bx bx-list-ul"></i> Itens do pedido</div>
                <ul class="lead-items-list" style="margin:0; color:var(--text-2);">${itensPedido(p)}</ul>
                <div style="margin-top:8px; font-size:13px; font-weight:700; color:var(--text);">
                    Total: ${App.money(p.subtotal||p.valor_negociado||0)}
                </div>
            </div>

            <!-- Histórico de atendimento -->
            <div>
                <div class="crm-section-title"><i class="bx bx-time-five"></i> Histórico de atendimento</div>
                <div class="crm-timeline" id="drawerTimeline">
                    <div style="text-align:center; color:var(--muted); font-size:13px; padding:12px 0;">Carregando...</div>
                </div>
            </div>`;
    }

    async function carregarHistoricoDrawer(leadId) {
        try {
            const hist = await App.api(`/catalogo-pedidos/${leadId}/historico`);
            renderTimeline(hist);
        } catch { renderTimeline([]); }
    }

    function renderTimeline(historico) {
        const tl = document.getElementById('drawerTimeline');
        if (!tl) return;
        if (!historico.length) {
            tl.innerHTML = '<p style="font-size:13px;color:var(--muted);text-align:center;padding:12px;">Nenhuma interação registrada.</p>';
            return;
        }
        const tipoIcone = { status:'bx-transfer', nota:'bx-note', contato:'bx-phone', venda:'bx-dollar-circle', orcamento:'bx-file' };
        tl.innerHTML = historico.map(h => {
            const tipo = h.tipo || 'nota';
            return `<div class="crm-timeline-item">
                <div class="crm-tl-dot ${tipo}"><i class="bx ${tipoIcone[tipo]||'bx-circle'}"></i></div>
                <div class="crm-tl-content">
                    <div class="crm-tl-desc">${esc(h.descricao||'')}</div>
                    <div class="crm-tl-meta">${esc(h.usuario_nome||'Sistema')} • ${new Date(h.criado_em).toLocaleString('pt-BR')}</div>
                </div>
            </div>`;
        }).join('');
    }

    async function salvarDrawer() {
        const id = drawerLeadId;
        if (!id) return;
        const payload = {
            status:               document.getElementById('drStatus')?.value,
            prioridade:           document.getElementById('drPrioridade')?.value,
            canal_atendimento:    document.getElementById('drCanal')?.value,
            responsavel_id:       document.getElementById('drResponsavel')?.value || null,
            proximo_contato:      document.getElementById('drProximo')?.value || null,
            valor_negociado:      document.getElementById('drValor')?.value,
            observacoes_internas: document.getElementById('drObs')?.value,
            motivo_perda:         document.getElementById('drMotivo')?.value
        };
        try {
            await App.api(`/catalogo-pedidos/${id}/crm`, { method:'PATCH', body: JSON.stringify(payload) });
            App.toast('success', 'Lead atualizado.');
            fecharDrawer();
            await carregar();
        } catch (err) { App.toast('error', err.message); }
    }

    // =========================================================
    // AÇÕES DE CONVERSÃO
    // =========================================================
    window.registrarContato = async (id) => {
        const { value: descricao } = await Swal.fire({
            title: 'Registrar contato',
            input: 'textarea',
            inputLabel: 'O que foi discutido?',
            inputPlaceholder: 'Descreva o contato realizado...',
            showCancelButton: true,
            confirmButtonText: 'Registrar',
            cancelButtonText: 'Cancelar'
        });
        if (!descricao) return;
        try {
            await App.api(`/catalogo-pedidos/${id}/historico`, {
                method: 'POST', body: JSON.stringify({ tipo: 'contato', descricao })
            });
            await App.api(`/catalogo-pedidos/${id}/status`, { method:'PATCH', body: JSON.stringify({ status:'EM_ATENDIMENTO' }) });
            App.toast('success', 'Contato registrado.');
            await carregar();
            if (drawerLeadId === id) carregarHistoricoDrawer(id);
        } catch (err) { App.toast('error', err.message); }
    };

    window.converterEmVenda = async (id) => {
        const p = pedidos.find(x => x.id === id);
        if (!p) return;
        const { value, isConfirmed } = await Swal.fire({
            title: 'Converter em venda',
            html: `
                <p style="margin-bottom:14px;">Confirme o valor final para registrar a venda.</p>
                <div style="text-align:left;">
                    <label style="font-size:13px;font-weight:700;">Valor da venda (R$)</label>
                    <input id="swalValorVenda" class="swal2-input" type="number" step="0.01"
                        value="${p.valor_negociado||p.subtotal||0}" style="margin-top:6px;">
                    <label style="font-size:13px;font-weight:700;display:block;margin-top:12px;">Observação</label>
                    <textarea id="swalObsVenda" class="swal2-textarea" placeholder="Opcional..."
                        style="margin-top:6px;">${esc(p.observacoes_internas||'')}</textarea>
                </div>`,
            showCancelButton: true,
            confirmButtonText: '<i class="bx bx-dollar-circle"></i> Confirmar venda',
            cancelButtonText: 'Cancelar',
            preConfirm: () => ({
                valor: document.getElementById('swalValorVenda').value,
                obs:   document.getElementById('swalObsVenda').value
            })
        });
        if (!isConfirmed || !value) return;
        try {
            await App.api(`/catalogo-pedidos/${id}/converter-venda`, {
                method: 'POST',
                body: JSON.stringify({ valor: value.valor, observacao: value.obs })
            });
            App.toast('success', 'Venda registrada!');
            fecharDrawer();
            await carregar();
        } catch (err) { App.toast('error', err.message); }
    };

    window.marcarComoOrcado = async (id) => {
        const p = pedidos.find(x => x.id === id);
        if (!p) return;
        const { value: valor } = await Swal.fire({
            title: 'Marcar como orçado',
            input: 'number',
            inputLabel: 'Valor do orçamento (R$)',
            inputValue: p.valor_negociado || p.subtotal || 0,
            showCancelButton: true,
            confirmButtonText: 'Confirmar orçamento',
            cancelButtonText: 'Cancelar'
        });
        if (valor === undefined || valor === null || valor === '') return;
        try {
            await App.api(`/catalogo-pedidos/${id}/crm`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'ORCADO', valor_negociado: valor })
            });
            await App.api(`/catalogo-pedidos/${id}/historico`, {
                method: 'POST',
                body: JSON.stringify({ tipo: 'orcamento', descricao: `Orçamento enviado: ${App.money(Number(valor))}` })
            });
            App.toast('success', 'Orçamento registrado.');
            fecharDrawer();
            await carregar();
        } catch (err) { App.toast('error', err.message); }
    };

    window.marcarComoNaoAtendido = async (id) => {
        const ok = await Swal.fire({
            title: 'Marcar como não atendido?',
            text: 'O lead voltará para a coluna "Novos" e reaparecerá no painel da loja como pendente.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Confirmar',
            cancelButtonText: 'Cancelar'
        });
        if (!ok.isConfirmed) return;
        try {
            await App.api(`/catalogo-pedidos/${id}/status`, { method:'PATCH', body: JSON.stringify({ status:'NOVO' }) });
            await adicionarHistoricoLocal(id, 'status', 'Marcado manualmente como não atendido.');
            App.toast('info', 'Lead marcado como não atendido.');
            fecharDrawer();
            await carregar();
        } catch (err) { App.toast('error', err.message); }
    };

    async function adicionarHistoricoLocal(id, tipo, descricao) {
        try { await App.api(`/catalogo-pedidos/${id}/historico`, { method:'POST', body: JSON.stringify({ tipo, descricao }) }); }
        catch { /* silencioso */ }
    }

    // =========================================================
    // CARREGAR
    // =========================================================
    async function carregar() {
        pedidos = await App.api('/catalogo-pedidos');
        try { usuarios = await App.api('/usuarios'); } catch { usuarios = []; }
        render();
    }

    // =========================================================
    // EVENT LISTENERS
    // =========================================================
    ['filtroStatus','filtroOrigem'].forEach(id =>
        document.getElementById(id)?.addEventListener('change', render));
    document.getElementById('buscaLead')?.addEventListener('input', render);

    document.querySelectorAll('.crm-view-tab').forEach(tab =>
        tab.addEventListener('click', () => { viewAtiva = tab.dataset.view; render(); })
    );

    document.getElementById('btnFecharDrawer')?.addEventListener('click', fecharDrawer);
    document.getElementById('btnCancelarDrawer')?.addEventListener('click', fecharDrawer);
    document.getElementById('btnSalvarDrawer')?.addEventListener('click', salvarDrawer);
    document.getElementById('crmDrawerOverlay')?.addEventListener('click', fecharDrawer);

    // =========================================================
    // INIT
    // =========================================================
    try { await carregar(); } catch (err) { App.toast('error', err.message); }
});
