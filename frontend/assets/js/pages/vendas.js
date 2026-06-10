document.addEventListener('DOMContentLoaded', () => {
    App.protectPage();
    App.renderSidebar('vendas');

    let produtos = [];
    let vendas = [];
    let parceiros = [];
    let produtoSelecionado = null;
    let valorFinalEditadoManualmente = false;
    let lote = [];

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
    const tabelaCarrinho = document.getElementById('tabelaCarrinhoVenda');
    const totalCarrinhoVenda = document.getElementById('totalCarrinhoVenda');
    const formaPagamentoVenda = document.getElementById('formaPagamentoVenda');
    const btnFecharVenda = document.getElementById('btnFecharVenda');

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
            ? `Será adicionado ao carrinho: ${App.money(valor)}`
            : 'Informe o valor total final deste item para adicioná-lo ao carrinho.';
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
        quantidadeVenda.value = 1;
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
            sugestoesProdutoVenda.innerHTML = produtos.map(cardSugestao).join('') || '<div class="suggestion-item text-muted">Nenhum produto disponível</div>';
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
                ${isVendaDiretaCentral() ? '<small class="text-success">Na venda direta, você pode alterar o valor final antes de adicionar ao carrinho.</small>' : ''}
            </div>`;
        atualizarCampoValorFinal({ preencher: true, forcar: true });
    }

    function badgePagamento(forma) {
        const f = String(forma || 'DINHEIRO').toUpperCase();
        const mapa = {
            DINHEIRO: ['Dinheiro', 'badge-green'],
            PIX: ['Pix', 'badge-blue'],
            CREDITO: ['Crédito', 'badge-yellow'],
            DEBITO: ['Débito', 'badge-yellow']
        };
        const [label, cls] = mapa[f] || [f, 'badge-blue'];
        return `<span class="badge ${cls}">${label}</span>`;
    }

    function renderCarrinho() {
        if (!lote.length) {
            tabelaCarrinho.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhum produto adicionado.</td></tr>';
            totalCarrinhoVenda.textContent = App.money(0);
            btnFecharVenda.disabled = true;
            return;
        }
        btnFecharVenda.disabled = false;
        tabelaCarrinho.innerHTML = lote.map((item, idx) => `
            <tr>
                <td><div class="product-cell">${App.imageTag(item.imagem_url)}<div><strong>${App.escapeHtml(item.nome)}</strong><br><small>${App.escapeHtml(item.variacao || '')}</small>${item.manual ? '<br><small class="badge badge-yellow">valor manual</small>' : ''}</div></div></td>
                <td>${App.number(item.quantidade)}</td>
                <td>${App.money(item.valor_unitario)}</td>
                <td><strong>${App.money(item.valor_total)}</strong></td>
                <td><button class="icon-btn" data-remover-carrinho="${idx}" title="Remover do carrinho"><i class="bx bx-trash"></i></button></td>
            </tr>`).join('');
        const total = lote.reduce((s, i) => s + Number(i.valor_total || 0), 0);
        totalCarrinhoVenda.textContent = App.money(total);
    }

    async function carregarVendas() {
        vendas = await App.api('/vendas');
        if (!vendas.length) {
            tabela.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhuma venda registrada.</td></tr>';
            return;
        }
        tabela.innerHTML = vendas.map(v => {
            const itens = v.itens || [];
            const primeiro = itens[0] || {};
            const extras = itens.length > 1
                ? `<br><small class="text-muted">+${itens.length - 1} ${itens.length - 1 === 1 ? 'item' : 'itens'}</small>`
                : '';
            return `
            <tr>
                <td><div class="product-cell">${App.imageTag(primeiro.imagem_url)}<div><strong>${App.escapeHtml(primeiro.produto_nome || '')}</strong><br><small>${App.escapeHtml(primeiro.variacao || '')}</small>${extras}</div></div></td>
                <td>${App.escapeHtml(v.data_formatada || '')}</td>
                <td>${App.number(v.quantidade)}</td>
                <td><strong>${App.money(v.valor_total)}</strong></td>
                <td>${badgePagamento(v.forma_pagamento)}</td>
                <td>${App.escapeHtml(v.loja || '-')}</td>
                <td><div class="actions">
                    ${itens.length > 1 ? `<button class="icon-btn" data-ver-venda="${App.escapeHtml(v.lote_codigo)}" title="Ver itens"><i class="bx bx-show"></i></button>` : ''}
                    <button class="icon-btn" data-estornar="${App.escapeHtml(v.lote_codigo)}" title="Estornar venda"><i class="bx bx-undo"></i></button>
                </div></td>
            </tr>`;
        }).join('');
    }

    function abrirDetalhesVenda(codigo) {
        const venda = vendas.find(v => v.lote_codigo === codigo);
        if (!venda) return;
        const itens = venda.itens || [];
        const linhas = itens.map(i => `
            <tr>
                <td style="padding:6px 8px;text-align:left;border-bottom:1px solid #e2e8f0;"><strong>${App.escapeHtml(i.produto_nome || '-')}</strong>${i.variacao ? `<br><small>${App.escapeHtml(i.variacao)}</small>` : ''}</td>
                <td style="padding:6px 8px;text-align:center;border-bottom:1px solid #e2e8f0;">${App.number(i.quantidade)}</td>
                <td style="padding:6px 8px;text-align:right;border-bottom:1px solid #e2e8f0;">${App.money(i.valor_total)}</td>
            </tr>`).join('');
        Swal.fire({
            title: `Venda ${App.escapeHtml(venda.lote_codigo)}`,
            html: `
                <div style="text-align:left;margin-bottom:10px;font-size:13px;">
                    <b>Data:</b> ${App.escapeHtml(venda.data_formatada || '')}<br>
                    <b>Pagamento:</b> ${badgePagamento(venda.forma_pagamento)}<br>
                    <b>Origem:</b> ${App.escapeHtml(venda.loja || '-')}
                </div>
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead><tr><th style="text-align:left;">Produto</th><th>Qtd</th><th style="text-align:right;">Total</th></tr></thead>
                    <tbody>${linhas}</tbody>
                </table>
                <div style="text-align:right;margin-top:10px;font-weight:700;">Total: ${App.money(venda.valor_total)}</div>`,
            confirmButtonText: 'Fechar'
        });
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
        if (lote.length) {
            lote = [];
            renderCarrinho();
            App.toast('warning', 'O carrinho foi limpo ao trocar a loja de origem.');
        }
        carregarProdutos().catch(err => App.toast('error', err.message));
    });

    quantidadeVenda.addEventListener('input', () => {
        atualizarCampoValorFinal({ preencher: true, forcar: true });
    });

    document.getElementById('btnAddCarrinhoVenda').addEventListener('click', () => {
        if (!produtoSelecionado) return App.toast('warning', 'Digite e selecione um produto da lista.');

        const quantidade = Number(quantidadeVenda.value || 0);
        if (quantidade <= 0) return App.toast('warning', 'Informe uma quantidade válida.');

        const qtdJaNoCarrinho = lote
            .filter(i => String(i.produto_id) === String(produtoSelecionado.produto_id))
            .reduce((s, i) => s + Number(i.quantidade || 0), 0);
        if (quantidade + qtdJaNoCarrinho > Number(produtoSelecionado.estoque || 0)) {
            return App.toast('error', 'Quantidade maior que o estoque disponível.');
        }

        let valorTotal;
        let manual = false;
        if (isVendaDiretaCentral()) {
            const valorManual = parseMoedaBR(valorFinalVenda.value);
            if (!Number.isFinite(valorManual) || valorManual <= 0) {
                return App.toast('warning', 'Informe um valor total final válido para este item. Exemplo: 39,90');
            }
            valorTotal = valorManual;
            manual = true;
        } else {
            valorTotal = Number(produtoSelecionado.preco_repasse || 0) * quantidade;
        }

        lote.push({
            produto_id: produtoSelecionado.produto_id,
            nome: produtoSelecionado.nome,
            variacao: produtoSelecionado.variacao,
            imagem_url: produtoSelecionado.imagem_url,
            quantidade,
            valor_unitario: valorTotal / quantidade,
            valor_total: valorTotal,
            manual
        });

        limparProdutoSelecionado();
        renderCarrinho();
    });

    tabelaCarrinho.addEventListener('click', (e) => {
        const idx = e.target.closest('[data-remover-carrinho]')?.dataset.removerCarrinho;
        if (idx !== undefined) { lote.splice(Number(idx), 1); renderCarrinho(); }
    });

    btnFecharVenda.addEventListener('click', async () => {
        if (!lote.length) return App.toast('warning', 'Adicione produtos ao carrinho.');

        const payload = {
            parceiro_id: App.isParceiro() ? null : (origemVenda.value || null),
            forma_pagamento: formaPagamentoVenda.value,
            itens: lote.map(i => ({
                produto_id: i.produto_id,
                quantidade: i.quantidade,
                ...(i.manual ? { valor_final_manual: i.valor_total.toFixed(2) } : {})
            }))
        };

        try {
            await App.api('/vendas/lote', { method: 'POST', body: JSON.stringify(payload) });
            App.toast('success', 'Venda registrada.');
            lote = [];
            formaPagamentoVenda.value = 'DINHEIRO';
            renderCarrinho();
            await carregarProdutos();
            await carregarVendas();
        } catch (err) {
            App.toast('error', err.message);
        }
    });

    tabela.addEventListener('click', async (e) => {
        const verBtn = e.target.closest('[data-ver-venda]');
        if (verBtn) return abrirDetalhesVenda(verBtn.dataset.verVenda);

        const codigo = e.target.closest('[data-estornar]')?.dataset.estornar;
        if (!codigo) return;
        const ok = await App.confirmDialog({ title: 'Estornar venda?', text: 'O estoque será devolvido automaticamente.', confirmText: 'Estornar' });
        if (!ok.isConfirmed) return;
        try {
            await App.api(`/vendas/${encodeURIComponent(codigo)}`, { method: 'DELETE' });
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

        const labelPagamento = (forma) => ({ DINHEIRO: 'Dinheiro', PIX: 'Pix', CREDITO: 'Crédito', DEBITO: 'Débito' }[String(forma || '').toUpperCase()] || forma || '-');
        const total = vendas.reduce((s, v) => s + Number(v.valor_total || 0), 0);
        doc.autoTable({
            startY: 50,
            head: [['Produto(s)', 'Data', 'Qtd', 'Pagamento', 'Origem', 'Total']],
            body: vendas.map(v => {
                const itens = v.itens || [];
                const produtosTxt = itens.map(i => `${i.produto_nome}${i.variacao ? ' - ' + i.variacao : ''} (x${i.quantidade})`).join('\n');
                return [produtosTxt, v.data_formatada, String(v.quantidade), labelPagamento(v.forma_pagamento), v.loja, App.money(v.valor_total)];
            }),
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
            renderCarrinho();
        } catch (err) {
            App.toast('error', err.message);
        }
    })();
});
