document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('solicitacoes');

    const STATUS_ADMIN = [
        ['ABERTA', 'Abertas'],
        ['SEPARACAO', 'Separação'],
        ['DESENVOLVIMENTO', 'Desenvolvimento'],
        ['AGUARDANDO_APROVACAO', 'Aguard. aprovação'],
        ['APROVADA', 'Aprovada'],
        ['PRODUCAO', 'Produção'],
        ['TRANSPORTE', 'Transporte'],
        ['CONCLUIDA', 'Concluída'],
        ['RECUSADA', 'Recusadas']
    ];

    let itens = [];
    let parceiros = [];

    const kanban = document.getElementById('kanban');
    const filtroBusca = document.getElementById('filtroBusca');
    const filtroTipo = document.getElementById('filtroTipo');
    const filtroPrioridade = document.getElementById('filtroPrioridade');
    const filtroLoja = document.getElementById('filtroLoja');

    function statusLabel(status) {
        return STATUS_ADMIN.find(s => s[0] === status)?.[1] || status;
    }

    function prioridadeClass(p) {
        const v = String(p || 'NORMAL').toLowerCase();
        return `priority-${v}`;
    }

    function textoItem(item) {
        return [item.codigo, item.nome_loja, item.titulo, item.descricao, item.produto_nome_snapshot, item.modelo_desejado, item.observacao].join(' ').toLowerCase();
    }

    function itensFiltrados() {
        const q = filtroBusca.value.trim().toLowerCase();
        const tipo = filtroTipo.value;
        const prioridade = filtroPrioridade.value;
        const loja = filtroLoja.value;
        return itens.filter(i => {
            if (q && !textoItem(i).includes(q)) return false;
            if (tipo && i.tipo_origem !== tipo) return false;
            if (prioridade && String(i.prioridade || 'NORMAL').toUpperCase() !== prioridade) return false;
            if (loja && String(i.parceiro_id) !== String(loja)) return false;
            return true;
        });
    }

    function renderFiltrosLojas() {
        const lojas = [...new Map(itens.map(i => [String(i.parceiro_id), { id: i.parceiro_id, nome: i.nome_loja }])).values()]
            .filter(l => l.id)
            .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));
        filtroLoja.innerHTML = '<option value="">Todas as lojas</option>' + lojas.map(l => `<option value="${l.id}">${App.escapeHtml(l.nome || `Loja ${l.id}`)}</option>`).join('');
    }

    function renderKanban() {
        const lista = itensFiltrados();
        kanban.innerHTML = STATUS_ADMIN.map(([status, label]) => {
            const cards = lista.filter(i => String(i.status_fluxo || i.status || 'ABERTA').toUpperCase() === status);
            return `
                <section class="kanban-column" data-status="${status}">
                    <div class="kanban-column-header">
                        <div class="kanban-column-title">${label}</div>
                        <div class="kanban-count">${cards.length}</div>
                    </div>
                    <div class="kanban-list" data-list="${status}">
                        ${cards.map(renderCard).join('') || '<div class="empty-state">Sem cards</div>'}
                    </div>
                </section>`;
        }).join('');
        bindDnD();
        bindActions();
    }

    function renderCard(item) {
        const status = String(item.status_fluxo || item.status || 'ABERTA').toUpperCase();
        const titulo = item.titulo || item.produto_nome_snapshot || item.modelo_desejado || 'Solicitação';
        const qtd = item.quantidade_desejada || item.quantidade_solicitada || 1;
        const valor = Number(item.valor_orcado ?? item.valor_estimado ?? 0);
        const atraso = item.data_prevista_entrega && new Date(item.data_prevista_entrega + 'T23:59:00') < new Date() && !['CONCLUIDA','RECUSADA'].includes(status);
        return `
            <article class="kanban-card" draggable="true" data-tipo="${item.tipo_origem}" data-id="${item.id}">
                <div class="card-top">
                    <div>
                        <div class="code">${App.escapeHtml(item.codigo || `#${item.id}`)} • ${item.tipo_origem === 'COTACAO' ? 'Cotação' : 'Solicitação'}</div>
                        <div class="loja">${App.escapeHtml(item.nome_loja || '-')}</div>
                    </div>
                    <span class="badge ${prioridadeClass(item.prioridade)}">${App.escapeHtml(item.prioridade || 'NORMAL')}</span>
                </div>
                <div class="titulo">${App.escapeHtml(titulo)}</div>
                <div class="desc">${App.escapeHtml(item.descricao || item.observacao || item.resposta_admin || '-')}</div>
                <div class="meta">
                    <div class="meta-item">Qtd<strong>${App.number(qtd)}</strong></div>
                    <div class="meta-item">Valor<strong>${valor ? App.money(valor) : '-'}</strong></div>
                    <div class="meta-item">Prazo<strong>${item.prazo_estimado_dias ? `${item.prazo_estimado_dias} dias` : '-'}</strong></div>
                    <div class="meta-item">Entrega<strong>${item.data_prevista_entrega ? App.escapeHtml(item.data_prevista_entrega) : '-'}</strong></div>
                </div>
                ${atraso ? '<span class="badge badge-red">ATRASADO</span>' : ''}
                <div class="card-actions">
                    <button type="button" class="btn btn-primary" data-orcamento>Orçamento</button>
                    <button type="button" class="btn btn-dark" data-pdf>Baixar PDF</button>
                    <button type="button" class="btn btn-secondary" data-historico>Histórico</button>
                    ${status === 'APROVADA' ? '<button type="button" class="btn btn-success" data-producao>Gerar produção</button>' : ''}
                    ${item.tipo_origem === 'SOLICITACAO' && ['ABERTA','SEPARACAO','APROVADA'].includes(status) ? '<button type="button" class="btn btn-success" data-remessa>Gerar remessa</button>' : ''}
                </div>
            </article>`;
    }

    function bindDnD() {
        document.querySelectorAll('.kanban-card').forEach(card => {
            card.addEventListener('dragstart', e => {
                e.dataTransfer.setData('text/plain', JSON.stringify({ tipo: card.dataset.tipo, id: card.dataset.id }));
            });
        });
        document.querySelectorAll('.kanban-column').forEach(col => {
            col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
            col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
            col.addEventListener('drop', async e => {
                e.preventDefault();
                col.classList.remove('drag-over');
                const data = JSON.parse(e.dataTransfer.getData('text/plain') || '{}');
                const status = col.dataset.status;
                if (!data.tipo || !data.id) return;
                await alterarStatus(data.tipo, data.id, status, 'Movido no Kanban');
            });
        });
    }

    function getCard(btn) {
        const card = btn.closest('.kanban-card');
        return { tipo: card.dataset.tipo, id: card.dataset.id, item: itens.find(i => String(i.tipo_origem) === String(card.dataset.tipo) && String(i.id) === String(card.dataset.id)) };
    }

    function bindActions() {
        document.querySelectorAll('[data-orcamento]').forEach(btn => btn.onclick = () => abrirOrcamento(getCard(btn)));
        document.querySelectorAll('[data-pdf]').forEach(btn => {
            btn.type = 'button';
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                gerarPdf(getCard(btn).item);
            };
        });
        document.querySelectorAll('[data-historico]').forEach(btn => abrirHistorico(getCard(btn)));
        document.querySelectorAll('[data-producao]').forEach(btn => gerarProducao(getCard(btn)));
        document.querySelectorAll('[data-remessa]').forEach(btn => gerarRemessa(getCard(btn)));
    }

    async function alterarStatus(tipo, id, status, observacao = '') {
        await App.api(`/solicitacoes-kanban/${tipo}/${id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status_fluxo: status, observacao })
        });
        App.toast('success', `Movido para ${statusLabel(status)}.`);
        await carregar();
    }

    async function abrirOrcamento({ tipo, id, item }) {
        const { value } = await Swal.fire({
            title: `Orçamento ${item.codigo || ''}`,
            width: 760,
            html: `
                <div class="form-grid text-left">
                    <div class="form-group"><label>Valor orçado total</label><input id="valorOrcado" class="swal2-input" value="${item.valor_orcado || item.valor_estimado || ''}" placeholder="Ex.: 120,00"></div>
                    <div class="form-group"><label>Prazo estimado em dias</label><input id="prazoDias" type="number" min="0" class="swal2-input" value="${item.prazo_estimado_dias || ''}" placeholder="Ex.: 7"></div>
                    <div class="form-group"><label>Data prevista de entrega</label><input id="dataPrevista" type="date" class="swal2-input" value="${item.data_prevista_entrega || ''}"></div>
                    <div class="form-group"><label>Prioridade</label><select id="prioridade" class="swal2-input"><option>BAIXA</option><option>NORMAL</option><option>ALTA</option><option>URGENTE</option></select></div>
                </div>
                <textarea id="obsOrcamento" class="swal2-textarea" placeholder="Observação visível para a loja / condições do orçamento">${App.escapeHtml(item.observacao_orcamento || item.resposta_admin || '')}</textarea>
                <textarea id="comentarioInterno" class="swal2-textarea" placeholder="Comentário interno, apenas admin vê">${App.escapeHtml(item.comentario_interno || '')}</textarea>
                <p class="text-muted text-left">Ao salvar, o card vai para <b>Aguardando aprovação</b> e a loja poderá baixar o PDF, aprovar ou recusar.</p>`,
            showCancelButton: true,
            confirmButtonText: 'Enviar para aprovação',
            didOpen: () => { document.getElementById('prioridade').value = item.prioridade || 'NORMAL'; },
            preConfirm: () => ({
                valor_orcado: document.getElementById('valorOrcado').value,
                prazo_estimado_dias: document.getElementById('prazoDias').value,
                data_prevista_entrega: document.getElementById('dataPrevista').value,
                prioridade: document.getElementById('prioridade').value,
                observacao_orcamento: document.getElementById('obsOrcamento').value,
                comentario_interno: document.getElementById('comentarioInterno').value
            })
        });
        if (!value) return;
        await App.api(`/solicitacoes-kanban/${tipo}/${id}/orcamento`, { method: 'PATCH', body: JSON.stringify(value) });
        App.toast('success', 'Orçamento enviado para aprovação da loja.');
        await carregar();
    }

    async function abrirHistorico({ tipo, id }) {
        const hist = await App.api(`/solicitacoes-kanban/${tipo}/${id}/historico`);
        await Swal.fire({
            title: 'Histórico do card',
            width: 760,
            html: hist.length ? `<div class="table-container"><table><thead><tr><th>Data</th><th>Usuário</th><th>De</th><th>Para</th><th>Obs.</th></tr></thead><tbody>${hist.map(h => `<tr><td>${App.escapeHtml(h.criado_em_formatado || '')}</td><td>${App.escapeHtml(h.usuario_nome || '-')}</td><td>${App.escapeHtml(h.status_anterior || '-')}</td><td>${App.escapeHtml(h.status_novo || '-')}</td><td>${App.escapeHtml(h.observacao || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p>Sem histórico.</p>'
        });
    }

    async function gerarProducao({ tipo, id }) {
        const ok = await App.confirmDialog({ title:'Gerar produção?', text:'Será criada uma produção planejada vinculada a esta solicitação/cotação.', confirmText:'Gerar produção', icon:'question' });
        if (!ok.isConfirmed) return;
        await App.api(`/solicitacoes-kanban/${tipo}/${id}/gerar-producao`, { method:'POST' });
        App.toast('success','Produção criada.');
        await carregar();
    }

    async function gerarRemessa({ tipo, id }) {
        const ok = await App.confirmDialog({ title:'Gerar remessa?', text:'Para reposições existentes, o sistema tentará criar uma remessa com o produto e quantidade solicitada.', confirmText:'Gerar remessa', icon:'question' });
        if (!ok.isConfirmed) return;
        await App.api(`/solicitacoes-kanban/${tipo}/${id}/gerar-remessa`, { method:'POST' });
        App.toast('success','Remessa criada.');
        await carregar();
    }

    async function gerarPdf(item) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const titulo = item.titulo || item.produto_nome_snapshot || item.modelo_desejado || 'Solicitação';
        doc.setFontSize(18); doc.text('PERSONALIZE Hub - Orçamento', 14, 18);
        doc.setFontSize(11);
        doc.text(`Código: ${item.codigo || item.id}`, 14, 30);
        doc.text(`Loja: ${item.nome_loja || '-'}`, 14, 37);
        doc.text(`Produto: ${titulo}`, 14, 44);
        doc.text(`Quantidade: ${item.quantidade_desejada || item.quantidade_solicitada || 1}`, 14, 51);
        doc.text(`Status: ${statusLabel(String(item.status_fluxo || item.status || '').toUpperCase())}`, 14, 58);
        doc.text(`Valor orçado: ${App.money(item.valor_orcado || item.valor_estimado || 0)}`, 14, 65);
        doc.text(`Prazo estimado: ${item.prazo_estimado_dias || '-'} dias`, 14, 72);
        doc.text(`Data prevista: ${item.data_prevista_entrega || '-'}`, 14, 79);
        doc.autoTable({ startY: 88, head: [['Descrição / Observações']], body: [[item.descricao || item.observacao || '-'], [item.observacao_orcamento || item.resposta_admin || '-']] });
        const y = doc.lastAutoTable.finalY + 14;
        doc.text('Aceite da loja:', 14, y);
        doc.text('Ao aprovar este orçamento pelo sistema, a loja confirma valor, prazo e condições descritas acima.', 14, y + 8);
        doc.save(`orcamento-${item.codigo || item.id}.pdf`);
    }

    async function carregar() {
        itens = await App.api('/solicitacoes-kanban');
        renderFiltrosLojas();
        renderKanban();
    }

    [filtroBusca, filtroTipo, filtroPrioridade, filtroLoja].forEach(el => el.addEventListener('input', renderKanban));
    document.getElementById('btnAtualizar').addEventListener('click', carregar);

    carregar().catch(err => App.toast('error', err.message));
});
