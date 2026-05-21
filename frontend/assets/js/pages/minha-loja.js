document.addEventListener('DOMContentLoaded', () => {
    App.protectPage({ parceiroOnly: true });
    App.renderSidebar('minha-loja');
    let estoque = [];
    let vendas = [];

    async function carregar() {
        const resumo = await App.api('/minha-loja/resumo');
        document.getElementById('nomeLoja').textContent = resumo.loja?.nome_loja || '-';
        document.getElementById('qtdAtual').textContent = App.number(resumo.estoque?.qtd_atual);
        document.getElementById('valorConsignado').textContent = App.money(resumo.estoque?.valor_consignado);
        document.getElementById('vendasMes').textContent = App.money(resumo.vendas?.total_vendas);
        estoque = await App.api(`/consignacoes/${App.user().parceiro_id}`);
        vendas = await App.api('/vendas');
        renderEstoque();
        renderVendas();
    }

    function renderEstoque() {
        const tbody = document.getElementById('tabelaEstoqueLoja');
        if (!estoque.length) return tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Sem estoque consignado.</td></tr>';
        tbody.innerHTML = estoque.map(i => `<tr><td><div class="product-cell">${App.imageTag(i.imagem_url)}<div><strong>${App.escapeHtml(i.produto_nome)}</strong></div></div></td><td>${App.escapeHtml(i.variacao || '')}</td><td><strong>${App.number(i.quantidade_atual)}</strong></td><td>${App.money(i.preco_repasse)}</td><td><strong>${App.money(i.valor_consignado_atual)}</strong></td></tr>`).join('');
    }
    function renderVendas() {
        const tbody = document.getElementById('tabelaVendasLoja');
        if (!vendas.length) return tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Nenhuma venda registrada.</td></tr>';
        tbody.innerHTML = vendas.slice(0, 20).map(v => `<tr><td><div class="product-cell">${App.imageTag(v.imagem_url)}<div><strong>${App.escapeHtml(v.produto_nome)}</strong><br><small>${App.escapeHtml(v.variacao || '')}</small></div></div></td><td>${App.escapeHtml(v.data_formatada || '')}</td><td>${App.number(v.quantidade)}</td><td><strong>${App.money(v.valor_total)}</strong></td></tr>`).join('');
    }

    async function gerarPDF() {
        if (!estoque.length) return App.toast('warning', 'Sem estoque para relatório.');
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const imagens = {};
        for (const item of estoque) imagens[item.consignacao_id] = await App.imageToDataURL(item.imagem_url);
        const total = estoque.reduce((s, i) => s + Number(i.valor_consignado_atual || 0), 0);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('PERSONALIZE Hub', 105, 18, { align: 'center' });
        doc.setFontSize(12); doc.text('RELATÓRIO DA MINHA LOJA', 105, 28, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(`Loja: ${document.getElementById('nomeLoja').textContent}`, 14, 42); doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`, 14, 48);
        doc.autoTable({ startY: 56, head: [['Foto','Produto','Qtd','Valor consignação','Total']], body: estoque.map(i => ['', `${i.produto_nome}\n${i.variacao || ''}`, String(i.quantidade_atual), App.money(i.preco_repasse), App.money(i.valor_consignado_atual)]), theme: 'grid', styles: { fontSize: 8, cellPadding: 2, minCellHeight: 18, overflow: 'linebreak' }, columnStyles: { 0: { cellWidth: 20 } }, didDrawCell: (data) => { if (data.section === 'body' && data.column.index === 0) { const img = imagens[estoque[data.row.index].consignacao_id]; if (img) doc.addImage(img, 'JPEG', data.cell.x + 2, data.cell.y + 2, 14, 14); } } });
        let y = (doc.lastAutoTable?.finalY || 56) + 10; if (y > 270) { doc.addPage(); y = 20; }
        doc.setFont('helvetica', 'bold'); doc.text(`VALOR TOTAL CONSIGNADO: ${App.money(total)}`, 14, y);
        doc.save('relatorio_minha_loja.pdf');
    }
    document.getElementById('btnPdfLoja').addEventListener('click', gerarPDF);
    carregar().catch(err => App.toast('error', err.message));
});
