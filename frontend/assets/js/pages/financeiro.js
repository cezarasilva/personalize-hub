document.addEventListener('DOMContentLoaded', () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('financeiro');

    let resumoAtual = { lojas: [], itens: [], resumo: {}, periodo: '' };
    let repasses = [];
    let parceiros = [];

    const periodoEl = document.getElementById('periodo');
    const filtroParceiro = document.getElementById('filtroParceiro');

    function mesAtual() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    async function carregarParceiros() {
        parceiros = await App.api('/parceiros');
        filtroParceiro.innerHTML = '<option value="">Todas as lojas</option>' + parceiros
            .map(p => `<option value="${p.id}">${App.escapeHtml(p.nome_loja)}</option>`).join('');
    }

    async function carregar() {
        const periodo = periodoEl.value || mesAtual();
        const parceiro = filtroParceiro.value;
        const qs = new URLSearchParams({ periodo });
        if (parceiro) qs.set('parceiro_id', parceiro);
        resumoAtual = await App.api(`/financeiro/v3/resumo?${qs.toString()}`);
        repasses = await App.api(`/financeiro/v3/repasses?${qs.toString()}`);
        renderResumo();
        renderTabelaLojas();
        renderProdutosVendidos();
        renderRepasses();
    }

    function formatPercent(valor) {
        return `${Number(valor || 0).toFixed(1).replace('.', ',')}%`;
    }

    function renderResumo() {
        const r = resumoAtual.resumo || {};
        document.getElementById('finTotalVendido').textContent = App.money(r.total_vendido || 0);
        document.getElementById('finLiquido').textContent = App.money(r.total_liquido || 0);
        document.getElementById('finComissao').textContent = App.money(r.total_margem || 0);
        document.getElementById('finPendente').textContent = App.money(r.total_pendente || 0);
        document.getElementById('finFaturamento').textContent = App.money(r.total_vendido || 0);
        document.getElementById('finGastos').textContent = App.money(r.total_gastos || 0);
        document.getElementById('finLucroLiquido').textContent = App.money(r.total_lucro_liquido || 0);
        document.getElementById('finMargemMedia').textContent = formatPercent(r.margem_lucro_media);
    }

    function statusBadge(st) {
        const status = String(st || 'NAO_GERADO').toUpperCase();
        if (status === 'PAGO') return '<span class="badge badge-green">PAGO</span>';
        if (status === 'PENDENTE') return '<span class="badge badge-yellow">PENDENTE</span>';
        if (status === 'CANCELADO') return '<span class="badge badge-red">CANCELADO</span>';
        return '<span class="badge badge-blue">NÃO GERADO</span>';
    }

    function renderTabelaLojas() {
        const tbody = document.getElementById('tabelaFinanceiro');
        const linhas = resumoAtual.lojas || [];
        if (!linhas.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhuma loja encontrada.</td></tr>';
            return;
        }
        tbody.innerHTML = linhas.map(l => `
            <tr>
                <td><strong>${App.escapeHtml(l.nome_loja || '-')}</strong><br><small>${App.escapeHtml(l.responsavel || '')}</small></td>
                <td>${App.number(l.total_vendas || 0)}</td>
                <td>${App.number(l.total_pecas || 0)}</td>
                <td><strong>${App.money(l.valor_total_vendido || 0)}</strong></td>
                <td>${App.money(l.valor_comissao_parceiro || 0)}</td>
                <td><strong>${App.money(l.valor_liquido_receber || 0)}</strong></td>
                <td>${statusBadge(l.status_fechamento)}</td>
                <td><div class="actions">
                    <button class="icon-btn" title="Gerar/atualizar fechamento desta loja" data-gerar-loja="${l.parceiro_id}"><i class="bx bx-check-circle"></i></button>
                    <button class="icon-btn" title="PDF da loja" data-pdf-loja="${l.parceiro_id}"><i class="bx bx-printer"></i></button>
                </div></td>
            </tr>`).join('');
    }

    function renderProdutosVendidos() {
        const tbody = document.getElementById('tabelaProdutosVendidos');
        const tfoot = document.getElementById('rodapeProdutosVendidos');
        const linhas = resumoAtual.produtos || [];
        if (!linhas.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhum produto vendido no período.</td></tr>';
            tfoot.innerHTML = '';
            return;
        }
        tbody.innerHTML = linhas.map(p => `
            <tr>
                <td><strong>${App.escapeHtml(p.produto_nome || '-')}</strong></td>
                <td>${App.escapeHtml(p.variacao || '-')}</td>
                <td>${App.escapeHtml(p.sku || '-')}</td>
                <td>${App.number(p.quantidade_vendida || 0)}</td>
                <td>${App.money(p.valor_faturado || 0)}</td>
                <td>${App.money(p.valor_custo || 0)}</td>
                <td><strong>${App.money(p.valor_lucro || 0)}</strong></td>
                <td>${formatPercent(p.margem_lucro)}</td>
            </tr>`).join('');

        const r = resumoAtual.resumo || {};
        tfoot.innerHTML = `
            <tr style="font-weight:600;">
                <td colspan="4">Totais do período</td>
                <td>${App.money(r.total_vendido || 0)}</td>
                <td>${App.money(r.total_gastos || 0)}</td>
                <td>${App.money(r.total_lucro_liquido || 0)}</td>
                <td>${formatPercent(r.margem_lucro_media)}</td>
            </tr>`;
    }

    function renderRepasses() {
        const tbody = document.getElementById('tabelaRepasses');
        if (!repasses.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Nenhum fechamento gerado para os filtros atuais.</td></tr>';
            return;
        }
        tbody.innerHTML = repasses.map(r => `
            <tr>
                <td>#${r.id}</td>
                <td><strong>${App.escapeHtml(r.nome_loja || '-')}</strong></td>
                <td>${App.escapeHtml(r.mes_referencia || '')}</td>
                <td>${App.money(r.valor_total_vendido)}</td>
                <td>${App.money(r.valor_comissao_parceiro)}</td>
                <td><strong>${App.money(r.valor_liquido_receber)}</strong></td>
                <td>${statusBadge(r.status_pagamento)}</td>
                <td>${App.escapeHtml(r.atualizado_em_formatado || '')}</td>
                <td><div class="actions">
                    <button class="icon-btn" title="Ver detalhes" data-detalhe-repasse="${r.id}"><i class="bx bx-show"></i></button>
                    <button class="icon-btn" title="PDF do repasse" data-pdf-repasse="${r.id}"><i class="bx bx-printer"></i></button>
                    ${String(r.status_pagamento).toUpperCase() === 'PAGO'
                        ? `<button class="icon-btn" title="Reabrir como pendente" data-status-repasse="${r.id}" data-status="PENDENTE"><i class="bx bx-lock-open"></i></button>`
                        : `<button class="icon-btn" title="Marcar como pago" data-status-repasse="${r.id}" data-status="PAGO"><i class="bx bx-dollar-circle"></i></button>`}
                </div></td>
            </tr>`).join('');
    }

    async function gerarFechamento(parceiroId = '') {
        const periodo = periodoEl.value || mesAtual();
        const body = { periodo };
        if (parceiroId) body.parceiro_id = parceiroId;
        const resp = await App.api('/financeiro/v3/repasses/gerar', { method: 'POST', body: JSON.stringify(body) });
        App.toast('success', resp.mensagem || 'Fechamento gerado.');
        await carregar();
    }

    async function alterarStatus(id, status) {
        const msg = status === 'PAGO'
            ? 'Confirmar pagamento deste repasse?'
            : 'Reabrir este repasse como pendente?';
        const conf = await App.confirmDialog({ title: msg, text: 'A alteração ficará registrada na auditoria.', confirmText: 'Confirmar', icon: 'question' });
        if (!conf.isConfirmed) return;
        const resp = await App.api(`/financeiro/v3/repasses/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status_pagamento: status }) });
        App.toast('success', resp.mensagem || 'Status atualizado.');
        await carregar();
    }

    async function abrirDetalheRepasse(id) {
        const dados = await App.api(`/financeiro/v3/repasses/${id}`);
        const r = dados.repasse;
        const linhas = dados.itens.map(i => `
            <tr>
                <td style="text-align:left;padding:6px;">${App.escapeHtml(i.produto_nome)}<br><small>${App.escapeHtml(i.variacao || '')}</small></td>
                <td style="padding:6px;">${App.number(i.quantidade)}</td>
                <td style="padding:6px;">${App.money(i.preco_repasse)}</td>
                <td style="padding:6px;"><b>${App.money(i.total_repasse)}</b></td>
            </tr>`).join('');
        await Swal.fire({
            title: `Repasse #${r.id} - ${App.escapeHtml(r.nome_loja || '')}`,
            width: 900,
            html: `<div style="text-align:left;margin-bottom:10px;"><b>Mês:</b> ${App.escapeHtml(r.mes_referencia)}<br><b>Status:</b> ${App.escapeHtml(r.status_pagamento)}<br><b>Total a receber:</b> ${App.money(r.valor_liquido_receber)}</div>
                <div style="overflow:auto;max-height:420px;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr><th>Produto</th><th>Qtd</th><th>Valor repasse</th><th>Total</th></tr></thead><tbody>${linhas || '<tr><td colspan="4">Sem itens</td></tr>'}</tbody></table></div>`,
            showCancelButton: true,
            confirmButtonText: 'Gerar PDF',
            cancelButtonText: 'Fechar'
        }).then(resp => { if (resp.isConfirmed) gerarPDFRepasse(id); });
    }

    async function gerarPDFRepasse(id) {
        const dados = await App.api(`/financeiro/v3/repasses/${id}`);
        await gerarPDF({ tipo: 'repasse', repasse: dados.repasse, itens: dados.itens });
    }

    async function gerarPDFLoja(parceiroId) {
        const loja = (resumoAtual.lojas || []).find(l => String(l.parceiro_id) === String(parceiroId));
        const itens = (resumoAtual.itens || []).filter(i => String(i.parceiro_id) === String(parceiroId));
        await gerarPDF({ tipo: 'loja', repasse: { ...loja, mes_referencia: resumoAtual.periodo, status_pagamento: loja?.status_fechamento }, itens });
    }

    async function gerarPDFGeral() {
        await gerarPDF({ tipo: 'geral', repasse: { nome_loja: 'Todas as lojas', mes_referencia: resumoAtual.periodo, status_pagamento: 'RESUMO' }, lojas: resumoAtual.lojas || [], itens: resumoAtual.itens || [] });
    }

    async function gerarPDF({ tipo, repasse, itens = [], lojas = [] }) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('PERSONALIZE Hub', 105, 16, { align: 'center' });
        doc.setFontSize(12); doc.text(tipo === 'geral' ? 'FECHAMENTO FINANCEIRO GERAL' : 'FECHAMENTO FINANCEIRO POR LOJA', 105, 25, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
        doc.text(`Loja: ${repasse.nome_loja || '-'}`, 14, 38);
        doc.text(`Mês referência: ${repasse.mes_referencia || resumoAtual.periodo || '-'}`, 14, 44);
        doc.text(`Status: ${repasse.status_pagamento || repasse.status_fechamento || '-'}`, 14, 50);
        doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`, 120, 38);

        let y = 60;
        if (tipo === 'geral') {
            doc.autoTable({
                startY: y,
                head: [['Loja', 'Peças', 'Total vendido', 'Margem loja', 'A receber', 'Status']],
                body: lojas.map(l => [l.nome_loja, String(l.total_pecas || 0), App.money(l.valor_total_vendido), App.money(l.valor_comissao_parceiro), App.money(l.valor_liquido_receber), l.status_fechamento || 'NAO_GERADO']),
                theme: 'grid', styles: { fontSize: 8 }
            });
        } else {
            doc.autoTable({
                startY: y,
                head: [['Produto', 'Variação', 'Qtd', 'Repasse unit.', 'Total repasse']],
                body: itens.map(i => [i.produto_nome || '-', i.variacao || '', String(i.quantidade || 0), App.money(i.preco_repasse || 0), App.money(i.total_repasse || 0)]),
                theme: 'grid', styles: { fontSize: 8, overflow: 'linebreak' }, columnStyles: { 0: { cellWidth: 62 } }
            });
        }
        y = (doc.lastAutoTable?.finalY || y) + 8;
        const totalVendido = tipo === 'geral' ? (resumoAtual.resumo?.total_vendido || 0) : (repasse.valor_total_vendido || itens.reduce((s, i) => s + Number(i.total_vendido || 0), 0));
        const totalLiquido = tipo === 'geral' ? (resumoAtual.resumo?.total_liquido || 0) : (repasse.valor_liquido_receber || itens.reduce((s, i) => s + Number(i.total_repasse || 0), 0));
        const totalMargem = tipo === 'geral' ? (resumoAtual.resumo?.total_margem || 0) : (repasse.valor_comissao_parceiro || (Number(totalVendido) - Number(totalLiquido)));
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
        doc.text(`Total vendido: ${App.money(totalVendido)}`, 14, y); y += 7;
        doc.text(`Margem da loja: ${App.money(totalMargem)}`, 14, y); y += 7;
        doc.text(`Valor a receber PERSONALIZE: ${App.money(totalLiquido)}`, 14, y); y += 14;
        if (y > 250) { doc.addPage(); y = 30; }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        const texto = 'Este documento representa o fechamento financeiro do período informado, considerando as vendas registradas no sistema e os valores de repasse cadastrados para cada produto. Conferir os valores antes da marcação como pago.';
        doc.text(doc.splitTextToSize(texto, 182), 14, y); y += 28;
        if (y > 260) { doc.addPage(); y = 40; }
        doc.line(18, y, 88, y); doc.line(122, y, 192, y); y += 5;
        doc.text('PERSONALIZE', 53, y, { align: 'center' });
        doc.text('Loja parceira', 157, y, { align: 'center' });
        const nome = tipo === 'geral' ? `financeiro_geral_${resumoAtual.periodo}` : `repasse_${repasse.nome_loja || repasse.id}_${repasse.mes_referencia || resumoAtual.periodo}`;
        doc.save(`${nome}.pdf`.replace(/[\s/\\]+/g, '_'));
    }

    async function gerarPDFProdutos() {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        const r = resumoAtual.resumo || {};
        const produtos = resumoAtual.produtos || [];

        doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('PERSONALIZE Hub', 105, 16, { align: 'center' });
        doc.setFontSize(12); doc.text('RELATÓRIO DETALHADO DE PRODUTOS VENDIDOS', 105, 25, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
        doc.text(`Mês referência: ${resumoAtual.periodo || '-'}`, 14, 38);
        doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`, 120, 38);

        const startY = 48;
        doc.autoTable({
            startY,
            head: [['Produto', 'Variação', 'SKU', 'Qtd', 'Faturado', 'Gasto', 'Lucro', 'Margem']],
            body: produtos.map(p => [
                p.produto_nome || '-',
                p.variacao || '-',
                p.sku || '-',
                String(p.quantidade_vendida || 0),
                App.money(p.valor_faturado || 0),
                App.money(p.valor_custo || 0),
                App.money(p.valor_lucro || 0),
                formatPercent(p.margem_lucro)
            ]),
            foot: [['Totais', '', '', '', App.money(r.total_vendido || 0), App.money(r.total_gastos || 0), App.money(r.total_lucro_liquido || 0), formatPercent(r.margem_lucro_media)]],
            theme: 'grid', styles: { fontSize: 8, overflow: 'linebreak' }, columnStyles: { 0: { cellWidth: 52 } },
            footStyles: { fontStyle: 'bold', fillColor: [240, 240, 240], textColor: [0, 0, 0] }
        });

        let y = (doc.lastAutoTable?.finalY || startY) + 10;
        if (y > 260) { doc.addPage(); y = 30; }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        const texto = 'Este relatório considera o faturamento (valor vendido), o gasto (custo de produção das peças vendidas) e o lucro líquido (faturamento menos gasto) de cada produto no período selecionado.';
        doc.text(doc.splitTextToSize(texto, 182), 14, y);

        doc.save(`relatorio_produtos_${resumoAtual.periodo}.pdf`.replace(/[\s/\\]+/g, '_'));
    }

    document.getElementById('btnFiltrarFinanceiro').addEventListener('click', carregar);
    document.getElementById('btnAtualizar').addEventListener('click', carregar);
    document.getElementById('btnGerarTodos').addEventListener('click', () => gerarFechamento('').catch(err => App.toast('error', err.message)));
    document.getElementById('btnPdfGeral').addEventListener('click', () => gerarPDFGeral().catch(err => App.toast('error', err.message)));
    document.getElementById('btnPdfProdutos').addEventListener('click', () => gerarPDFProdutos().catch(err => App.toast('error', err.message)));

    document.addEventListener('click', async (e) => {
        const gerarLoja = e.target.closest('[data-gerar-loja]')?.dataset.gerarLoja;
        const pdfLoja = e.target.closest('[data-pdf-loja]')?.dataset.pdfLoja;
        const detalhe = e.target.closest('[data-detalhe-repasse]')?.dataset.detalheRepasse;
        const pdfRepasse = e.target.closest('[data-pdf-repasse]')?.dataset.pdfRepasse;
        const statusId = e.target.closest('[data-status-repasse]')?.dataset.statusRepasse;
        const status = e.target.closest('[data-status-repasse]')?.dataset.status;
        try {
            if (gerarLoja) return await gerarFechamento(gerarLoja);
            if (pdfLoja) return await gerarPDFLoja(pdfLoja);
            if (detalhe) return await abrirDetalheRepasse(detalhe);
            if (pdfRepasse) return await gerarPDFRepasse(pdfRepasse);
            if (statusId) return await alterarStatus(statusId, status);
        } catch (err) {
            App.toast('error', err.message);
        }
    });

    periodoEl.value = mesAtual();
    carregarParceiros().then(carregar).catch(err => App.toast('error', err.message));
});
