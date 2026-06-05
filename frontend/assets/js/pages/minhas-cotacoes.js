document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage({ parceiroOnly: true });
    App.renderSidebar('minhas-cotacoes');

    const STATUS_LOJA = [
        ['ABERTA', 'Aberta'],
        ['SEPARACAO', 'Separando'],
        ['DESENVOLVIMENTO', 'Desenvolvendo'],
        ['AGUARDANDO_APROVACAO', 'Aguardando aprovação'],
        ['APROVADA', 'Aprovada'],
        ['PRODUCAO', 'Produzindo'],
        ['TRANSPORTE', 'Em transporte'],
        ['CONCLUIDA', 'Concluída'],
        ['RECUSADA', 'Recusada']
    ];

    let itens = [];
    const lista = document.getElementById('listaSolicitacoes');
    const filtroBusca = document.getElementById('filtroBusca');
    const filtroStatus = document.getElementById('filtroStatus');

    function labelStatus(status) { return STATUS_LOJA.find(s => s[0] === status)?.[1] || status; }
    function idxStatus(status) { return STATUS_LOJA.findIndex(s => s[0] === status); }
    function textoItem(i) { return [i.codigo, i.titulo, i.descricao, i.produto_nome_snapshot, i.modelo_desejado, i.observacao, i.resposta_admin].join(' ').toLowerCase(); }

    function filtrados() {
        const q = filtroBusca.value.trim().toLowerCase();
        const st = filtroStatus.value;
        return itens.filter(i => {
            const status = String(i.status_fluxo || i.status || 'ABERTA').toUpperCase();
            if (q && !textoItem(i).includes(q)) return false;
            if (st && status !== st) return false;
            return true;
        });
    }

    function renderTimeline(status) {
        const atual = idxStatus(status);
        return `<div class="timeline-box">${STATUS_LOJA.map(([key, label], idx) => `<span class="timeline-step ${idx < atual ? 'done' : idx === atual ? 'current' : ''}">${label}</span>`).join('')}</div>`;
    }

    function render() {
        const data = filtrados();
        lista.innerHTML = data.length ? data.map(renderItem).join('') : '<div class="empty-state">Nenhuma solicitação encontrada.</div>';
        bindActions();
    }

    function renderItem(item) {
        const status = String(item.status_fluxo || item.status || 'ABERTA').toUpperCase();
        const titulo = item.titulo || item.produto_nome_snapshot || item.modelo_desejado || 'Solicitação';
        const qtd = item.quantidade_desejada || item.quantidade_solicitada || 1;
        const valor = Number(item.valor_orcado ?? item.valor_estimado ?? 0);
        const aguardando = status === 'AGUARDANDO_APROVACAO';
        return `
            <article class="item-card" data-tipo="${item.tipo_origem}" data-id="${item.id}">
                <div class="item-card-header">
                    <div class="item-card-main">
                        ${App.imageTag(item.imagem_url || item.imagem_url_snapshot)}
                        <div>
                            <strong>${App.escapeHtml(item.codigo || `#${item.id}`)} • ${item.tipo_origem === 'COTACAO' ? 'Cotação' : 'Solicitação'}</strong>
                            <h3>${App.escapeHtml(titulo)}</h3>
                            <p class="text-muted">${App.escapeHtml(item.descricao || item.observacao || '-')}</p>
                            <small>Qtd: ${App.number(qtd)} • Status: ${App.escapeHtml(labelStatus(status))}</small>
                        </div>
                    </div>
                    ${App.badgeStatus(status)}
                </div>
                ${renderTimeline(status)}
                <div class="orcamento-box">
                    <div class="grid grid-4">
                        <div><small>Valor</small><strong>${valor ? App.money(valor) : '-'}</strong></div>
                        <div><small>Prazo</small><strong>${item.prazo_estimado_dias ? `${item.prazo_estimado_dias} dias` : '-'}</strong></div>
                        <div><small>Previsão</small><strong>${item.data_prevista_entrega || '-'}</strong></div>
                        <div><small>Prioridade</small><strong>${item.prioridade || 'NORMAL'}</strong></div>
                    </div>
                    <p>${App.escapeHtml(item.observacao_orcamento || item.resposta_admin || 'Aguardando retorno da PERSONALIZE.')}</p>
                    <div class="orcamento-actions">
                        <button class="btn btn-dark" data-pdf>Baixar PDF do orçamento</button>
                        ${aguardando ? '<button class="btn btn-success" data-aprovar>Aprovar orçamento</button><button class="btn btn-danger" data-recusar>Recusar</button>' : ''}
                    </div>
                </div>
            </article>`;
    }

    function getCard(btn) {
        const card = btn.closest('.item-card');
        return { tipo: card.dataset.tipo, id: card.dataset.id, item: itens.find(i => String(i.tipo_origem) === String(card.dataset.tipo) && String(i.id) === String(card.dataset.id)) };
    }

    function bindActions() {
        document.querySelectorAll('[data-pdf]').forEach(btn => btn.onclick = () => gerarPdf(getCard(btn).item));
        document.querySelectorAll('[data-aprovar]').forEach(btn => btn.onclick = () => aprovar(getCard(btn)));
        document.querySelectorAll('[data-recusar]').forEach(btn => btn.onclick = () => recusar(getCard(btn)));
    }

    async function aprovar({ tipo, id }) {
        const ok = await App.confirmDialog({ title:'Aprovar orçamento?', text:'Ao aprovar, você confirma valor, prazo e condições informadas pela PERSONALIZE.', confirmText:'Aprovar', icon:'question' });
        if (!ok.isConfirmed) return;
        await App.api(`/solicitacoes-kanban/${tipo}/${id}/aprovar`, { method:'POST' });
        App.toast('success','Orçamento aprovado.');
        await carregar();
    }

    async function recusar({ tipo, id }) {
        const { value } = await Swal.fire({ title:'Recusar orçamento', input:'textarea', inputLabel:'Motivo da recusa', inputPlaceholder:'Ex.: valor alto, prazo longo...', showCancelButton:true, confirmButtonText:'Recusar' });
        if (value === undefined) return;
        await App.api(`/solicitacoes-kanban/${tipo}/${id}/recusar`, { method:'POST', body:JSON.stringify({ motivo_recusa:value || 'Recusado pela loja' }) });
        App.toast('success','Orçamento recusado.');
        await carregar();
    }

    function gerarPdf(item) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const titulo = item.titulo || item.produto_nome_snapshot || item.modelo_desejado || 'Solicitação';
        doc.setFontSize(18); doc.text('PERSONALIZE Hub - Orçamento', 14, 18);
        doc.setFontSize(11);
        doc.text(`Código: ${item.codigo || item.id}`, 14, 30);
        doc.text(`Loja: ${item.nome_loja || '-'}`, 14, 37);
        doc.text(`Produto: ${titulo}`, 14, 44);
        doc.text(`Quantidade: ${item.quantidade_desejada || item.quantidade_solicitada || 1}`, 14, 51);
        doc.text(`Status: ${labelStatus(String(item.status_fluxo || item.status || '').toUpperCase())}`, 14, 58);
        doc.text(`Valor orçado: ${App.money(item.valor_orcado || item.valor_estimado || 0)}`, 14, 65);
        doc.text(`Prazo estimado: ${item.prazo_estimado_dias || '-'} dias`, 14, 72);
        doc.text(`Data prevista: ${item.data_prevista_entrega || '-'}`, 14, 79);
        doc.autoTable({ startY: 88, head: [['Descrição / Condições']], body: [[item.descricao || item.observacao || '-'], [item.observacao_orcamento || item.resposta_admin || '-']] });
        const y = doc.lastAutoTable.finalY + 14;
        doc.text('Aceite eletrônico:', 14, y);
        doc.text('A aprovação pelo sistema confirma o aceite do valor, prazo e condições deste orçamento.', 14, y + 8);
        doc.save(`orcamento-${item.codigo || item.id}.pdf`);
    }

    async function carregar() {
        itens = await App.api('/solicitacoes-kanban');
        render();
    }

    [filtroBusca, filtroStatus].forEach(el => el.addEventListener('input', render));
    document.getElementById('btnAtualizar').addEventListener('click', carregar);
    carregar().catch(err => App.toast('error', err.message));
});
