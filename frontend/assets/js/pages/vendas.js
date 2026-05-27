document.addEventListener('DOMContentLoaded', () => {
    App.protectPage();
    App.renderSidebar('vendas');

    let produtos = [];
    let vendas = [];
    let parceiros = [];
    let produtoSelecionado = null;
    let valorFinalEditadoManualmente = false;

    const buscaProdutoVenda = document.getElementById('buscaProdutoVenda');
    const sugestoesProdutoVenda = document.getElementById('sugestoesProdutoVenda');
    const produtoBox = document.getElementById('produtoVendaSelecionadoBox');
    const origemVenda = document.getElementById('origemVenda');
    const grupoOrigemVenda = document.getElementById('grupoOrigemVenda');
    const quantidadeVenda = document.getElementById('quantidadeVenda');
    const grupoValorFinalVenda = document.getElementById('grupoValorFinalVenda');
    const valorFinalVenda = document.getElementById('valorFinalVenda');
    const resumoValorVenda = document.getElementById('resumoValorVenda');
    const tabela = document.getElementById('tabelaVendas');

    function normalizarProduto(p) {
        return {
            produto_id: p.produto_id || p.id,
            id: p.produto_id || p.id,
            nome: p.produto_nome || p.nome || 'Produto sem nome',
            variacao: p.variacao || '',
            sku: p.sku || '',
            imagem_url: p.imagem_url || '',
            estoque: p.quantidade_atual ?? p.estoque_central ?? 0,
            preco_venda: Number(p.preco_venda || 0),
            preco_repasse: Number(p.preco_repasse || 0),
            origem_parceiro: Boolean(p.quantidade_atual !== undefined)
        };
    }

    function parseMoedaBR(valor) {
        if (valor === undefined || valor === null) return NaN;
        if (typeof valor === 'number') return Number.isFinite(valor) ? valor : NaN;
        let s = String(valor).trim();
        if (!s) return NaN;
        s = s.replace(/[^0-9,.-]/g, '');
        const temVirgula = s.includes(',');
        const temPonto = s.includes('.');

        if (temVirgula && temPonto) {
            const ultimaVirgula = s.lastIndexOf(',');
            const ultimoPonto = s.lastIndexOf('.');
            if (ultimaVirgula > ultimoPonto) s = s.replace(/\./g, '').replace(',', '.');
            else s = s.replace(/,/g, '');
        } else if (temVirgula) {
            s = s.replace(',', '.');
        } else if (temPonto && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
            s = s.replace(/\./g, '');
        }

        const n = Number(s);
        return Number.isFinite(n) ? n : NaN;
    }

    function formatarDecimalInput(numero) {
        return Number(numero || 0).toFixed(2).replace('.', ',');
    }

    function isVendaDiretaCentral() {
        return App.isAdmin() && !origemVenda.value;
    }

    function calcularValorPadraoVenda() {
        if (!produtoSelecionado || !isVendaDiretaCentral()) return 0;
        const qtd = Number(quantidadeVenda.value || 1);
        return Number(produtoSelecionado.preco_venda || 0) * qtd;
    }

    function atualizarResumoValorVenda() {
        if (!resumoValorVenda) return;
        if (!produtoSelecionado || !isVendaDiretaCentral()) {
            resumoValorVenda.textContent = '';
            return;
        }
        const valor = parseMoedaBR(valorFinalVenda.value);
        resumoValorVenda.textContent = Number.isFinite(valor) && valor > 0
            ? `Será registrado no extrato: ${App.money(valor)}`
            : 'Informe o valor total final para registrar a venda direta.';
    }

    function atualizarCampoValorFinal({ preencher = false, forcar = false } = {}) {
        const mostrar = Boolean(produtoSelecionado && isVendaDiretaCentral());
        grupoValorFinalVenda.classList.toggle('hidden', !mostrar);
        if (!mostrar) {
            valorFinalVenda.value = '';
            valorFinalEditadoManualmente = false;
            atualizarResumoValorVenda();
            return;
        }
        if (forcar || (preencher && !valorFinalEditadoManualmente) || !valorFinalVenda.value) {
            valorFinalVenda.value = formatarDecimalInput(calcularValorPadraoVenda());
        }
        atualizarResumoValorVenda();
    }

    function limparProdutoSelecionado() {
        produtoSelecionado = null;
        valorFinalEditadoManualmente = false;
        buscaProdutoVenda.value = '';
        sugestoesProdutoVenda.classList.add('hidden');
        produtoBox.classList.add('hidden');
        produtoBox.innerHTML = '';
        atualizarCampoValorFinal();
    }

    async function carregarParceiros() {
        if (!App.isAdmin()) return;
        parceiros = await App.api('/parceiros');
        origemVenda.innerHTML = '<option value="">Sede Central</option>' + parceiros
            .filter(p => String(p.status || '').toUpperCase() === 'ATIVO')
            .map(p => `<option value="${p.id}">${App.escapeHtml(p.nome_loja)}</option>`)
            .join('');
    }

    async function carregarProdutos() {
        limparProdutoSelecionado();

        if (App.isParceiro()) {
            produtos = (await App.api(`/consignacoes/${App.user().parceiro_id}`)).map(normalizarProduto);
            grupoOrigemVenda.classList.add('hidden');
            origemVenda.value = App.user().parceiro_id;
        } else {
            const parceiroId = origemVenda.value;
            if (parceiroId) {
                produtos = (await App.api(`/consignacoes/${parceiroId}`)).map(normalizarProduto);
            } else {
                produtos = (await App.api('/produtos')).map(normalizarProduto);
            }
            grupoOrigemVenda.classList.remove('hidden');
        }

        if (!produtos.length) {
            buscaProdutoVenda.placeholder = App.isAdmin() && origemVenda.value
                ? 'Essa loja não possui estoque consignado disponível...'
                : 'Nenhum produto disponível para venda...';
        } else {
            buscaProdutoVenda.placeholder = 'Digite o nome, variação ou SKU do produto...';
        }
    }

    function renderSugestoes() {
        const termo = buscaProdutoVenda.value.trim().toLowerCase();
        if (!termo) {
            sugestoesProdutoVenda.innerHTML = produtos.slice(0, 12).map(cardSugestao).join('') || '<div class="suggestion-item text-muted">Nenhum produto disponível</div>';
            sugestoesProdutoVenda.classList.remove('hidden');
            return;
        }

        const filtrados = produtos
            .filter(p => [p.nome, p.variacao, p.sku].join(' ').toLowerCase().includes(termo))
            .slice(0, 14);

        sugestoesProdutoVenda.innerHTML = filtrados.length
            ? filtrados.map(cardSugestao).join('')
            : '<div class="suggestion-item text-muted">Nenhum produto encontrado</div>';
        sugestoesProdutoVenda.classList.remove('hidden');
    }

    function cardSugestao(p) {
        const precoLabel = p.origem_parceiro || origemVenda.value ? `Repasse ${App.money(p.preco_repasse)}` : `Venda ${App.money(p.preco_venda)}`;
        return `
            <div class="suggestion-item" data-produto="${p.produto_id}">
                ${App.imageTag(p.imagem_url)}
                <div>
                    <strong>${App.escapeHtml(p.nome)}</strong><br>
                    <small>${App.escapeHtml(p.variacao || '')}${p.sku ? ` • SKU ${App.escapeHtml(p.sku)}` : ''} • Estoque ${App.number(p.estoque)} • ${precoLabel}</small>
                </div>
            </div>`;
    }

    function selecionarProduto(id) {
        produtoSelecionado = produtos.find(p => String(p.produto_id) === String(id));
        if (!produtoSelecionado) return;
        valorFinalEditadoManualmente = false;

        buscaProdutoVenda.value = `${produtoSelecionado.nome}${produtoSelecionado.variacao ? ' - ' + produtoSelecionado.variacao : ''}`;
        sugestoesProdutoVenda.classList.add('hidden');

        const precoLabel = produtoSelecionado.origem_parceiro || origemVenda.value
            ? `Valor de repasse ${App.money(produtoSelecionado.preco_repasse)}`
            : `Preço de venda ${App.money(produtoSelecionado.preco_venda)}`;

        produtoBox.classList.remove('hidden');
        produtoBox.innerHTML = `
            ${App.imageTag(produtoSelecionado.imagem_url)}
            <div>
                <strong>${App.escapeHtml(produtoSelecionado.nome)}</strong>
                <p class="text-muted">
                    ${App.escapeHtml(produtoSelecionado.variacao || '')}
                    ${produtoSelecionado.sku ? ` • SKU ${App.escapeHtml(produtoSelecionado.sku)}` : ''}
                    • Estoque ${App.number(produtoSelecionado.estoque)}
                    • ${precoLabel}
                </p>
                ${isVendaDiretaCentral() ? '<small class="text-success">Na venda direta, você pode alterar o valor final antes de confirmar.</small>' : ''}
            </div>`;
        atualizarCampoValorFinal({ preencher: true, forcar: true });
    }

    async function carregarVendas() {
        vendas = await App.api('/vendas');
        if (!vendas.length) {
            tabela.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhuma venda registrada.</td></tr>';
            return;
        }
        tabela.innerHTML = vendas.map(v => `
            <tr>
                <td><div class="product-cell">${App.imageTag(v.imagem_url)}<div><strong>${App.escapeHtml(v.produto_nome)}</strong><br><small>${App.escapeHtml(v.variacao || '')}</small></div></div></td>
                <td>${App.escapeHtml(v.data_formatada || '')}</td>
                <td>${App.number(v.quantidade)}</td>
                <td><strong>${App.money(v.valor_total)}</strong></td>
                <td>${App.escapeHtml(v.loja || '-')}</td>
                <td><button class="icon-btn" data-estornar="${v.id}" title="Estornar venda"><i class="bx bx-undo"></i></button></td>
            </tr>`).join('');
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-wrap')) sugestoesProdutoVenda.classList.add('hidden');
    });

    buscaProdutoVenda.addEventListener('focus', renderSugestoes);
    buscaProdutoVenda.addEventListener('input', () => {
        produtoSelecionado = null;
        valorFinalEditadoManualmente = false;
        produtoBox.classList.add('hidden');
        renderSugestoes();
    });

    sugestoesProdutoVenda.addEventListener('click', (e) => {
        const id = e.target.closest('[data-produto]')?.dataset.produto;
        if (id) selecionarProduto(id);
    });

    origemVenda.addEventListener('change', () => {
        carregarProdutos().catch(err => App.toast('error', err.message));
    });

    quantidadeVenda.addEventListener('input', () => {
        atualizarCampoValorFinal({ preencher: true, forcar: true });
    });

    document.getElementById('formVenda').addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!produtoSelecionado) {
            return App.toast('warning', 'Digite e selecione um produto da lista.');
        }

        const quantidade = Number(quantidadeVenda.value || 0);
        if (quantidade <= 0) return App.toast('warning', 'Informe uma quantidade válida.');
        if (quantidade > Number(produtoSelecionado.estoque || 0)) return App.toast('error', 'Quantidade maior que o estoque disponível.');

        const payload = {
            produto_id: produtoSelecionado.produto_id,
            quantidade,
            parceiro_id: App.isParceiro() ? null : (origemVenda.value || null)
        };

        if (isVendaDiretaCentral()) {
            const valorManual = parseMoedaBR(valorFinalVenda.value);
            if (!Number.isFinite(valorManual) || valorManual <= 0) {
                return App.toast('warning', 'Informe um valor total final válido para a venda direta. Exemplo: 39,90');
            }
            payload.valor_total_manual = valorManual.toFixed(2);
        }

        try {
            await App.api('/vendas', { method: 'POST', body: JSON.stringify(payload) });
            App.toast('success', 'Venda registrada.');
            quantidadeVenda.value = 1;
            valorFinalVenda.value = '';
            await carregarProdutos();
            await carregarVendas();
        } catch (err) {
            App.toast('error', err.message);
        }
    });

    tabela.addEventListener('click', async (e) => {
        const id = e.target.closest('[data-estornar]')?.dataset.estornar;
        if (!id) return;
        const ok = await App.confirmDialog({ title: 'Estornar venda?', text: 'O estoque será devolvido automaticamente.', confirmText: 'Estornar' });
        if (!ok.isConfirmed) return;
        try {
            await App.api(`/vendas/${id}`, { method: 'DELETE' });
            App.toast('success', 'Venda estornada.');
            await carregarProdutos();
            await carregarVendas();
        } catch (err) {
            App.toast('error', err.message);
        }
    });

    function gerarPDF() {
        if (!vendas.length) return App.toast('warning', 'Nenhuma venda para imprimir.');
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text('PERSONALIZE Hub', 105, 18, { align: 'center' });
        doc.setFontSize(12);
        doc.text('FECHAMENTO DE VENDAS', 105, 28, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`, 14, 42);

        const total = vendas.reduce((s, v) => s + Number(v.valor_total || 0), 0);
        doc.autoTable({
            startY: 50,
            head: [['Produto', 'Data', 'Qtd', 'Origem', 'Total']],
            body: vendas.map(v => [`${v.produto_nome} - ${v.variacao || ''}`, v.data_formatada, String(v.quantidade), v.loja, App.money(v.valor_total)]),
            theme: 'grid',
            styles: { fontSize: 8, overflow: 'linebreak' },
            headStyles: { fillColor: [16, 185, 129] }
        });

        let y = (doc.lastAutoTable?.finalY || 50) + 10;
        if (y > 270) { doc.addPage(); y = 20; }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text(`TOTAL: ${App.money(total)}`, 14, y);
        doc.save('fechamento_vendas.pdf');
    }

    document.getElementById('btnPdfVendas').addEventListener('click', gerarPDF);

    (async function iniciar() {
        try {
            await carregarParceiros();
            await carregarProdutos();
            await carregarVendas();
        } catch (err) {
            App.toast('error', err.message);
        }
    })();
});
