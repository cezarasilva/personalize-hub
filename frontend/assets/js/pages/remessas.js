document.addEventListener('DOMContentLoaded', () => {
    App.protectPage();
    App.renderSidebar('remessas');

    let parceiros = [];
    let produtos = [];
    let lote = [];
    let estoqueAtual = [];
    let historicoRemessas = [];
    let produtoSelecionado = null;

    const parceiroDestino = document.getElementById('parceiroDestino');
    const buscaProduto = document.getElementById('buscaProdutoRemessa');
    const sugestoes = document.getElementById('sugestoesProduto');
    const produtoBox = document.getElementById('produtoSelecionadoBox');
    const valorConsignacaoRemessa = document.getElementById('valorConsignacaoRemessa');
    const tabelaLote = document.getElementById('tabelaLote');
    const tabelaEstoque = document.getElementById('tabelaEstoque');
    const tabelaHistorico = document.getElementById('tabelaHistoricoRemessas');

    function parseMoeda(valor, padrao = 0) {
        if (valor === undefined || valor === null || String(valor).trim() === '') return padrao;
        if (typeof valor === 'number') return Number.isFinite(valor) ? valor : padrao;
        let s = String(valor).trim().replace(/[^0-9,.-]/g, '');
        if (!s) return padrao;
        const temVirgula = s.includes(',');
        const temPonto = s.includes('.');
        if (temVirgula && temPonto) {
            if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
            else s = s.replace(/,/g, '');
        } else if (temVirgula) {
            s = s.replace(',', '.');
        } else if (temPonto && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
            s = s.replace(/\./g, '');
        }
        const n = Number(s);
        return Number.isFinite(n) ? n : padrao;
    }

    function formatarInputMoeda(valor) {
        const n = parseMoeda(valor, NaN);
        if (!Number.isFinite(n)) return '';
        return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function ajustarTelaParceiro(loja) {
        const novaRemessaCard = document.getElementById('novaRemessaCard');
        const pageTitle = document.querySelector('.page-title h1');
        const pageSubtitle = document.querySelector('.page-title p');
        const lojaCardTitle = parceiroDestino?.closest('.card')?.querySelector('.card-title');
        const grupoSelect = parceiroDestino?.closest('.form-group');

        if (App.isParceiro()) {
            if (pageTitle) pageTitle.textContent = ' Minhas Remessas';
            if (pageSubtitle) pageSubtitle.textContent = 'Acompanhe as remessas, estoque consignado, assinatura e PDFs da sua loja.';
            if (lojaCardTitle) lojaCardTitle.textContent = 'Minha loja';
            if (grupoSelect) {
                grupoSelect.innerHTML = `
                    <label>Loja</label>
                    <div class="readonly-box"><strong>${App.escapeHtml(loja?.nome_loja || 'Minha loja')}</strong><br><small class="text-muted">Consulta automática pelo seu acesso de parceiro.</small></div>
                `;
            }
            novaRemessaCard?.classList.add('hidden');
        } else {
            if (pageTitle) pageTitle.textContent = ' Remessas';
            if (pageSubtitle) pageSubtitle.textContent = 'Envie produtos, acompanhe remessas por loja, gere PDF com foto, valor consignado e assinatura digital, e estorne remessas quando necessário.';
            if (lojaCardTitle) lojaCardTitle.textContent = 'Loja selecionada';
            novaRemessaCard?.classList.remove('hidden');
        }
    }

    async function carregarBase() {
        const selecionado = parceiroDestino.value;
        if (App.isAdmin()) {
            parceiros = await App.api('/parceiros');
            produtos = await App.api('/produtos');
            parceiroDestino.disabled = false;
            document.getElementById('novaRemessaCard')?.classList.remove('hidden');
            parceiroDestino.innerHTML = '<option value="">Selecione a loja...</option>' + parceiros
                .filter(p => String(p.status || '').toUpperCase() === 'ATIVO')
                .map(p => `<option value="${p.id}">${App.escapeHtml(p.nome_loja)}</option>`).join('');
            if (selecionado) parceiroDestino.value = selecionado;
            ajustarTelaParceiro(null);
        } else {
            const parceiroId = App.user().parceiro_id;
            if (!parceiroId) {
                App.toast('error', 'Seu usuário parceiro não possui loja vinculada. Peça ao administrador para vincular o usuário a uma loja.');
                return;
            }
            const lista = await App.api('/parceiros');
            const loja = Array.isArray(lista) ? (lista.find(p => String(p.id) === String(parceiroId)) || lista[0]) : lista;
            parceiros = loja ? [loja] : [];
            produtos = [];
            parceiroDestino.innerHTML = `<option value="${parceiroId}">${App.escapeHtml(loja?.nome_loja || 'Minha loja')}</option>`;
            parceiroDestino.value = parceiroId;
            parceiroDestino.disabled = true;
            ajustarTelaParceiro(loja || { id: parceiroId, nome_loja: 'Minha loja' });
        }
        renderLote();
        await carregarDadosLoja();
    }

    async function carregarDadosLoja() {
        await Promise.all([carregarEstoque(), carregarHistoricoRemessas()]);
    }

    function renderSugestoes() {
        const q = buscaProduto.value.toLowerCase().trim();
        if (!q) return sugestoes.classList.add('hidden');
        const filtrados = produtos
            .filter(p => [p.nome, p.categoria, p.variacao, p.sku].join(' ').toLowerCase().includes(q))
            .slice(0, 14);
        if (!filtrados.length) {
            sugestoes.innerHTML = '<div class="suggestion-item text-muted">Nenhum produto encontrado</div>';
        } else {
            sugestoes.innerHTML = filtrados.map(p => `
                <div class="suggestion-item" data-produto="${p.id}">
                    ${App.imageTag(p.imagem_url)}
                    <div><strong>${App.escapeHtml(p.nome)}</strong><br><small>${App.escapeHtml(p.variacao || '')} • Estoque ${App.number(p.estoque_central)} • Repasse ${App.money(p.preco_repasse)}</small></div>
                </div>`).join('');
        }
        sugestoes.classList.remove('hidden');
    }

    function selecionarProduto(id) {
        produtoSelecionado = produtos.find(p => String(p.id) === String(id));
        if (!produtoSelecionado) return;
        buscaProduto.value = `${produtoSelecionado.nome} - ${produtoSelecionado.variacao || ''}`;
        sugestoes.classList.add('hidden');
        produtoBox.classList.remove('hidden');
        const precoPadrao = Number(produtoSelecionado.preco_repasse || 0);
        valorConsignacaoRemessa.value = formatarInputMoeda(precoPadrao);
        produtoBox.innerHTML = `${App.imageTag(produtoSelecionado.imagem_url)}<div><strong>${App.escapeHtml(produtoSelecionado.nome)}</strong><p class="text-muted">${App.escapeHtml(produtoSelecionado.variacao || '')} • Estoque central ${App.number(produtoSelecionado.estoque_central)} • Valor padrão ${App.money(precoPadrao)}</p><small class="text-muted">Você pode mudar o valor de consignação só para esta remessa antes de adicionar ao lote.</small></div>`;
    }

    function renderLote() {
        if (!lote.length) {
            tabelaLote.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum produto adicionado.</td></tr>';
            document.getElementById('btnEnviarLote').disabled = true;
            return;
        }
        document.getElementById('btnEnviarLote').disabled = false;
        tabelaLote.innerHTML = lote.map((item, idx) => `
            <tr>
                <td><div class="product-cell">${App.imageTag(item.imagem_url)}<div><strong>${App.escapeHtml(item.nome)}</strong><br><small>${App.escapeHtml(item.variacao || '')}</small>${item.preco_personalizado ? '<br><small class="badge badge-yellow">valor personalizado</small>' : ''}</div></div></td>
                <td>${App.number(item.quantidade)} un.</td>
                <td>${App.money(item.preco_repasse_padrao)}</td>
                <td><strong>${App.money(item.preco_repasse)}</strong></td>
                <td><strong>${App.money(item.preco_repasse * item.quantidade)}</strong></td>
                <td><button class="icon-btn" data-remover-lote="${idx}" title="Remover do lote"><i class="bx bx-trash"></i></button></td>
            </tr>`).join('');
    }

    async function carregarEstoque() {
        const id = parceiroDestino.value;
        if (!id) { estoqueAtual = []; return renderEstoque(); }
        estoqueAtual = await App.api(`/consignacoes/${id}`);
        renderEstoque();
    }

    async function carregarHistoricoRemessas() {
        const id = parceiroDestino.value;
        if (!id) { historicoRemessas = []; return renderHistorico(); }
        const resposta = await App.api(`/remessas?parceiro_id=${encodeURIComponent(id)}`);
        if (Array.isArray(resposta)) {
            historicoRemessas = resposta;
            document.getElementById('avisoHistorico').textContent = '';
        } else {
            historicoRemessas = resposta.linhas || [];
            document.getElementById('avisoHistorico').textContent = resposta.aviso || '';
        }
        renderHistorico();
    }

    function renderEstoque() {
        const qtdTotal = estoqueAtual.reduce((s, i) => s + Number(i.quantidade_atual || 0), 0);
        const valorTotal = estoqueAtual.reduce((s, i) => s + Number(i.valor_consignado_atual || 0), 0);
        document.getElementById('statQtdEstoque').textContent = App.number(qtdTotal);
        document.getElementById('statValorEstoque').textContent = App.money(valorTotal);

        const btnDevolverTudo = document.getElementById('btnDevolverTudoEstoque');
        if (btnDevolverTudo) btnDevolverTudo.classList.toggle('hidden', !(App.isAdmin() && qtdTotal > 0));

        if (!estoqueAtual.length) {
            tabelaEstoque.innerHTML = '<tr><td colspan="7" class="empty-state">Selecione uma loja para ver o estoque ou nenhum item encontrado.</td></tr>';
            return;
        }
        tabelaEstoque.innerHTML = estoqueAtual.map(item => `
            <tr>
                <td><div class="product-cell">${App.imageTag(item.imagem_url)}<div><strong>${App.escapeHtml(item.produto_nome)}</strong><br><small>${App.escapeHtml(item.variacao || '')}</small></div></div></td>
                <td><strong>${App.number(item.quantidade_atual)}</strong></td>
                <td>${App.number(item.quantidade_enviada)}</td>
                <td>${App.number(item.quantidade_vendida)}</td>
                <td>${App.money(item.preco_repasse)}${Number(item.preco_repasse_padrao || item.preco_repasse) !== Number(item.preco_repasse || 0) ? `<br><small class="text-muted">padrão ${App.money(item.preco_repasse_padrao)}</small>` : ''}</td>
                <td><strong>${App.money(item.valor_consignado_atual)}</strong></td>
                <td>${App.isAdmin() ? `<div class="actions"><button class="icon-btn" data-ajustar="${item.consignacao_id}" title="Ajustar saldo"><i class="bx bx-edit"></i></button><button class="icon-btn" data-devolver-qtd="${item.consignacao_id}" title="Devolver quantidade específica"><i class="bx bx-undo"></i></button><button class="icon-btn" data-devolver="${item.consignacao_id}" title="Devolver todo o saldo deste produto"><i class="bx bx-chevrons-left"></i></button></div>` : '<span class="text-muted">Somente consulta</span>'}</td>
            </tr>`).join('');
    }

    function renderHistorico() {
        if (!parceiroDestino.value) {
            tabelaHistorico.innerHTML = '<tr><td colspan="9" class="empty-state">Selecione uma loja para ver o histórico de remessas.</td></tr>';
            return;
        }
        if (!historicoRemessas.length) {
            tabelaHistorico.innerHTML = '<tr><td colspan="9" class="empty-state">Nenhuma remessa encontrada para essa loja.</td></tr>';
            return;
        }
        tabelaHistorico.innerHTML = historicoRemessas.map(r => `
            <tr>
                <td><strong>${App.escapeHtml(r.codigo || `#${r.id}`)}</strong></td>
                <td>${App.escapeHtml(r.data_formatada || '')}</td>
                <td>${App.escapeHtml(r.nome_loja || '-')}</td>
                <td>${badgeRemessa(r.status)}<br>${badgeAssinatura(r.status_assinatura)}</td>
                <td>${App.number(r.total_itens)}</td>
                <td>${App.number(r.total_quantidade)} <small class="text-muted">/ est. ${App.number(r.total_estornado)}</small></td>
                <td><strong>${App.money(r.valor_total)}</strong></td>
                <td><strong>${App.money(r.valor_saldo)}</strong></td>
                <td><div class="actions">
                    <button class="icon-btn" data-ver-remessa="${r.id}" title="Ver detalhes"><i class="bx bx-show"></i></button>
                    <button class="icon-btn" data-pdf-remessa="${r.id}" title="PDF da remessa"><i class="bx bx-printer"></i></button>
                    ${String(r.status_assinatura || '').toUpperCase() !== 'ASSINADA' ? `<button class="icon-btn" data-assinar-remessa="${r.id}" title="Assinar recebimento"><i class="bx bx-pen"></i></button>` : ''}
                    ${App.isAdmin() ? `<button class="icon-btn" data-estornar-remessa="${r.id}" title="Estornar remessa"><i class="bx bx-undo"></i></button>` : ''}
                </div></td>
            </tr>`).join('');
    }

    function badgeRemessa(status) {
        const st = String(status || '').toUpperCase();
        if (st === 'ENVIADA') return '<span class="badge badge-blue">ENVIADA</span>';
        if (st === 'ESTORNADA') return '<span class="badge badge-red">ESTORNADA</span>';
        if (st === 'ESTORNO_PARCIAL') return '<span class="badge badge-yellow">ESTORNO PARCIAL</span>';
        if (st === 'RECEBIDA') return '<span class="badge badge-green">RECEBIDA</span>';
        return App.badgeStatus(st || 'PENDENTE');
    }

    function badgeAssinatura(status) {
        const st = String(status || 'PENDENTE').toUpperCase();
        if (st === 'ASSINADA') return '<span class="badge badge-green">ASSINADA</span>';
        return '<span class="badge badge-yellow">ASS. PENDENTE</span>';
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-wrap')) sugestoes.classList.add('hidden');
    });
    buscaProduto.addEventListener('input', renderSugestoes);
    valorConsignacaoRemessa?.addEventListener('blur', () => { valorConsignacaoRemessa.value = formatarInputMoeda(valorConsignacaoRemessa.value); });
    sugestoes.addEventListener('click', (e) => {
        const id = e.target.closest('[data-produto]')?.dataset.produto;
        if (id) selecionarProduto(id);
    });

    document.getElementById('btnAddLote').addEventListener('click', (e) => {
        e.preventDefault();
        if (!parceiroDestino.value) return App.toast('warning', 'Selecione a loja antes de montar a remessa.');
        if (!produtoSelecionado) return App.toast('warning', 'Busque e selecione um produto.');
        const quantidade = Number(document.getElementById('qtdRemessa').value || 0);
        if (quantidade <= 0) return App.toast('warning', 'Informe uma quantidade válida.');
        const precoPadrao = Number(produtoSelecionado.preco_repasse || 0);
        const precoRemessa = parseMoeda(valorConsignacaoRemessa.value, precoPadrao);
        if (!Number.isFinite(precoRemessa) || precoRemessa < 0) return App.toast('warning', 'Informe um valor de consignação válido para esta remessa.');
        const qtdTotalNoLote = lote
            .filter(i => String(i.produto_id) === String(produtoSelecionado.id))
            .reduce((s, i) => s + Number(i.quantidade || 0), 0) + quantidade;
        if (qtdTotalNoLote > Number(produtoSelecionado.estoque_central || 0)) return App.toast('error', 'Quantidade maior que o estoque central disponível.');

        lote.push({
            produto_id: produtoSelecionado.id,
            nome: produtoSelecionado.nome,
            variacao: produtoSelecionado.variacao,
            quantidade,
            preco_repasse_padrao: precoPadrao,
            preco_repasse: precoRemessa,
            preco_repasse_manual: precoRemessa,
            preco_personalizado: Math.abs(precoRemessa - precoPadrao) > 0.009,
            imagem_url: produtoSelecionado.imagem_url
        });
        produtoSelecionado = null;
        buscaProduto.value = '';
        produtoBox.classList.add('hidden');
        valorConsignacaoRemessa.value = '';
        document.getElementById('qtdRemessa').value = 1;
        renderLote();
    });

    tabelaLote.addEventListener('click', (e) => {
        const idx = e.target.closest('[data-remover-lote]')?.dataset.removerLote;
        if (idx !== undefined) { lote.splice(Number(idx), 1); renderLote(); }
    });

    parceiroDestino.addEventListener('change', carregarDadosLoja);
    document.getElementById('btnAtualizarTudo').addEventListener('click', carregarBase);

    document.getElementById('btnEnviarLote').addEventListener('click', async () => {
        if (!parceiroDestino.value) return App.toast('warning', 'Selecione uma loja.');
        if (!lote.length) return App.toast('warning', 'Adicione produtos ao lote.');
        const lojaId = parceiroDestino.value;
        try {
            const resp = await App.api('/consignacoes/lote', {
                method: 'POST',
                body: JSON.stringify({
                    parceiro_id: lojaId,
                    observacao: document.getElementById('observacaoRemessa').value,
                    itens: lote.map(i => ({ produto_id: i.produto_id, quantidade: i.quantidade, preco_repasse_manual: i.preco_repasse_manual }))
                })
            });
            App.toast('success', resp.mensagem || 'Remessa enviada.');
            const remessaId = resp.remessa?.id;
            lote = [];
            document.getElementById('observacaoRemessa').value = '';
            renderLote();
            await carregarBase();
            parceiroDestino.value = lojaId;
            await carregarDadosLoja();
            if (remessaId) {
                const ok = await Swal.fire({ title: 'Remessa criada', text: 'Deseja gerar o PDF desta remessa agora?', icon: 'success', showCancelButton: true, confirmButtonText: 'Gerar PDF', cancelButtonText: 'Depois' });
                if (ok.isConfirmed) await gerarPDFRemessa(remessaId);
            }
        } catch (err) { App.toast('error', err.message); }
    });

    tabelaEstoque.addEventListener('click', async (e) => {
        const ajustar = e.target.closest('[data-ajustar]')?.dataset.ajustar;
        const devolverQtd = e.target.closest('[data-devolver-qtd]')?.dataset.devolverQtd;
        const devolver = e.target.closest('[data-devolver]')?.dataset.devolver;
        if (ajustar) {
            const atual = estoqueAtual.find(i => String(i.consignacao_id) === String(ajustar));
            const result = await Swal.fire({ title: 'Ajustar quantidade', input: 'number', inputValue: atual?.quantidade_atual || 0, inputAttributes: { min: 0 }, showCancelButton: true, confirmButtonText: 'Salvar' });
            if (!result.isConfirmed) return;
            try { await App.api(`/consignacoes/${ajustar}`, { method: 'PUT', body: JSON.stringify({ nova_quantidade: result.value }) }); App.toast('success', 'Quantidade ajustada.'); await carregarDadosLoja(); }
            catch (err) { App.toast('error', err.message); }
        }
        if (devolverQtd) {
            const atual = estoqueAtual.find(i => String(i.consignacao_id) === String(devolverQtd));
            const max = Number(atual?.quantidade_atual || 0);
            if (max <= 0) return App.toast('warning', 'Não há saldo para devolver.');
            const result = await Swal.fire({
                title: 'Devolver quantidade',
                html: `<div style="text-align:left;margin-bottom:8px;"><b>${App.escapeHtml(atual?.produto_nome || '')}</b><br><small>${App.escapeHtml(atual?.variacao || '')}</small><br>Saldo atual: <strong>${App.number(max)}</strong></div>`,
                input: 'number',
                inputLabel: 'Quantas unidades devolver ao estoque central?',
                inputValue: max,
                inputAttributes: { min: 1, max: String(max), step: 1 },
                showCancelButton: true,
                confirmButtonText: 'Devolver'
            });
            if (!result.isConfirmed) return;
            const qtdDevolver = Number(result.value);
            if (!Number.isFinite(qtdDevolver) || qtdDevolver <= 0) return App.toast('warning', 'Informe uma quantidade válida.');
            if (qtdDevolver > max) return App.toast('warning', 'Quantidade maior que o saldo atual.');
            try {
                await App.api(`/consignacoes/${devolverQtd}`, { method: 'PUT', body: JSON.stringify({ nova_quantidade: max - qtdDevolver }) });
                App.toast('success', `${App.number(qtdDevolver)} unidade(s) devolvida(s) ao estoque central.`);
                await carregarDadosLoja();
            } catch (err) { App.toast('error', err.message); }
        }
        if (devolver) {
            const ok = await App.confirmDialog({ title: 'Devolver todo o saldo deste produto?', text: 'Toda a quantidade atual deste produto voltará para o estoque central. Para histórico por lote, prefira estornar pelo histórico de remessas.', confirmText: 'Confirmar' });
            if (!ok.isConfirmed) return;
            try { await App.api(`/consignacoes/${devolver}`, { method: 'DELETE' }); App.toast('success', 'Saldo devolvido.'); await carregarDadosLoja(); }
            catch (err) { App.toast('error', err.message); }
        }
    });

    document.getElementById('btnDevolverTudoEstoque')?.addEventListener('click', async () => {
        const lojaId = parceiroDestino.value;
        if (!lojaId) return App.toast('warning', 'Selecione uma loja.');
        const nomeLoja = parceiros.find(p => String(p.id) === String(lojaId))?.nome_loja || 'esta loja';
        const ok = await App.confirmDialog({
            title: 'Devolver todo o estoque da loja?',
            text: `Todo o saldo consignado de ${nomeLoja} (${App.number(estoqueAtual.reduce((s, i) => s + Number(i.quantidade_atual || 0), 0))} itens) voltará para o estoque central. Esta ação não pode ser desfeita item a item.`,
            confirmText: 'Devolver tudo',
            icon: 'warning'
        });
        if (!ok.isConfirmed) return;
        try {
            const resp = await App.api(`/consignacoes/parceiro/${lojaId}/tudo`, { method: 'DELETE' });
            App.toast('success', resp.mensagem || 'Estoque devolvido.');
            await carregarDadosLoja();
        } catch (err) { App.toast('error', err.message); }
    });

    tabelaHistorico.addEventListener('click', async (e) => {
        const ver = e.target.closest('[data-ver-remessa]')?.dataset.verRemessa;
        const pdf = e.target.closest('[data-pdf-remessa]')?.dataset.pdfRemessa;
        const estornar = e.target.closest('[data-estornar-remessa]')?.dataset.estornarRemessa;
        const assinar = e.target.closest('[data-assinar-remessa]')?.dataset.assinarRemessa;
        if (ver) return abrirDetalhesRemessa(ver);
        if (pdf) return gerarPDFRemessa(pdf);
        if (assinar) return abrirAssinaturaRemessa(assinar);
        if (estornar) return estornarRemessa(estornar);
    });

    async function abrirDetalhesRemessa(id) {
        try {
            const dados = await App.api(`/remessas/${id}`);
            const assinatura = await App.api(`/remessas/${id}/assinatura`).catch(() => null);
            const r = dados.remessa;
            const linhas = dados.itens.map(i => {
                const nome = i.produto_nome || i.produto_nome_snapshot || '-';
                const variacao = i.variacao || i.variacao_snapshot || '';
                const sku = i.sku || i.sku_snapshot || '';
                const qtd = Number(i.quantidade || i.quantidade_enviada || 0);
                const est = Number(i.quantidade_estornada || 0);
                const repasse = Number(i.preco_repasse_snapshot || i.preco_repasse_unitario || i.preco_repasse || 0);
                const saldo = Number(i.valor_saldo || i.valor_total_saldo || ((qtd - est) * repasse) || 0);
                return `
                <tr>
                    <td style="text-align:left; padding:8px;">
                        <div style="display:flex;align-items:center;gap:10px;">
                            ${App.imageTag(i.imagem_url || i.imagem_url_snapshot)}
                            <div>
                                <strong>${App.escapeHtml(nome)}</strong><br>
                                <small>${App.escapeHtml(variacao || '-')}</small>
                                ${sku ? `<br><small>SKU: ${App.escapeHtml(sku)}</small>` : ''}
                            </div>
                        </div>
                    </td>
                    <td style="padding:8px;text-align:center;">${App.number(qtd)}</td>
                    <td style="padding:8px;text-align:center;">${App.number(est)}</td>
                    <td style="padding:8px;text-align:right;">${App.money(repasse)}</td>
                    <td style="padding:8px;text-align:right;"><strong>${App.money(saldo)}</strong></td>
                </tr>`;
            }).join('');
            await Swal.fire({
                title: `Remessa ${App.escapeHtml(r.codigo || '#' + r.id)}`,
                width: 900,
                html: `
                    <div style="text-align:left; margin-bottom:12px;">
                        <b>Loja:</b> ${App.escapeHtml(r.nome_loja || '-')}<br>
                        <b>Data:</b> ${App.escapeHtml(r.data_formatada || '')}<br>
                        <b>Status:</b> ${App.escapeHtml(r.status || '')}<br>
                        <b>Assinatura:</b> ${assinatura ? `Assinada por ${App.escapeHtml(assinatura.nome_responsavel || '-')} em ${App.escapeHtml(assinatura.data_assinatura_formatada || '')}` : 'Pendente'}<br>
                        <b>Observação:</b> ${App.escapeHtml(r.observacao || '-')}
                    </div>
                    <div style="overflow:auto; max-height:420px;">
                    <table style="width:100%; border-collapse:collapse; font-size:13px;">
                        <thead><tr><th>Produto</th><th>Qtd</th><th>Estornada</th><th>Repasse</th><th>Saldo</th></tr></thead>
                        <tbody>${linhas}</tbody>
                    </table>
                    </div>`,
                showCancelButton: true,
                confirmButtonText: 'Gerar PDF',
                cancelButtonText: 'Fechar'
            }).then(resp => { if (resp.isConfirmed) gerarPDFRemessa(id); });
        } catch (err) { App.toast('error', err.message); }
    }

    async function estornarRemessa(id) {
        const rem = historicoRemessas.find(r => String(r.id) === String(id));
        if (String(rem?.status || '').toUpperCase() === 'ESTORNADA') return App.toast('warning', 'Essa remessa já foi estornada.');
        const motivo = await Swal.fire({
            title: 'Estornar remessa?',
            text: 'O saldo disponível na loja voltará para o estoque central. Se parte já foi vendida, o estorno será parcial.',
            input: 'textarea',
            inputLabel: 'Motivo/observação',
            inputValue: 'Estorno administrativo de remessa',
            showCancelButton: true,
            confirmButtonText: 'Estornar remessa',
            confirmButtonColor: '#dc2626',
            cancelButtonText: 'Cancelar'
        });
        if (!motivo.isConfirmed) return;
        try {
            const resp = await App.api(`/remessas/${id}/estornar`, { method: 'POST', body: JSON.stringify({ motivo: motivo.value }) });
            App.toast(resp.resultado?.parcial ? 'warning' : 'success', resp.mensagem || 'Remessa estornada.');
            await carregarDadosLoja();
        } catch (err) { App.toast('error', err.message); }
    }


    const TERMO_GUARDA = 'A loja parceira declara receber os produtos listados neste relatório em regime de consignação, comprometendo-se a zelar pela guarda, conservação, exposição e controle dos itens enquanto estiverem sob sua responsabilidade. Os produtos permanecem vinculados à PERSONALIZE até a venda, devolução, estorno ou acerto financeiro. Em caso de venda, perda, dano, extravio ou divergência de estoque, a loja parceira compromete-se a comunicar a PERSONALIZE e realizar o respectivo acerto conforme os valores de consignação descritos neste documento.';

    async function abrirAssinaturaRemessa(id) {
        const existente = await App.api(`/remessas/${id}/assinatura`).catch(() => null);
        if (existente) {
            return Swal.fire({
                title: 'Remessa já assinada',
                html: `<div style="text-align:left"><b>Responsável:</b> ${App.escapeHtml(existente.nome_responsavel || '-')}<br><b>Documento:</b> ${App.escapeHtml(existente.documento_responsavel || '-')}<br><b>Data:</b> ${App.escapeHtml(existente.data_assinatura_formatada || '')}</div><div style="margin-top:14px;text-align:center"><img src="${existente.assinatura_base64}" style="max-width:280px;border:1px solid #ddd;border-radius:8px;background:#fff"></div>`,
                confirmButtonText: 'Ok'
            });
        }
        try {
            const dados = await App.api(`/remessas/${id}`);
            _abrirPreviewAssinatura(id, dados.remessa, dados.itens);
        } catch (err) { App.toast('error', err.message); }
    }

    function _abrirPreviewAssinatura(id, r, itens) {
        const esc = App.escapeHtml;
        const qtdItem = (i) => Number(i.quantidade || i.quantidade_enviada || 0);
        const repasseItem = (i) => Number(i.preco_repasse_snapshot || i.preco_repasse_unitario || i.preco_repasse || 0);
        const totalOriginal = itens.reduce((s, i) => s + qtdItem(i) * repasseItem(i), 0);
        const totalSaldo = itens.reduce((s, i) => s + Number(i.valor_saldo || i.valor_total_saldo || ((qtdItem(i) - Number(i.quantidade_estornada || 0)) * repasseItem(i)) || 0), 0);

        const rowsHTML = itens.map(i => {
            const qtd = qtdItem(i); const est = Number(i.quantidade_estornada || 0); const rep = repasseItem(i);
            const saldo = Number(i.valor_saldo || i.valor_total_saldo || ((qtd - est) * rep) || 0);
            return `<tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:7px 8px;"><strong>${esc(i.produto_nome || '-')}</strong>${i.variacao ? `<br><small style="color:#64748b;">${esc(i.variacao)}</small>` : ''}</td>
                <td style="padding:7px 8px;text-align:center;">${qtd}</td>
                <td style="padding:7px 8px;text-align:center;">${est}</td>
                <td style="padding:7px 8px;text-align:right;">${App.money(rep)}</td>
                <td style="padding:7px 8px;text-align:right;">${App.money(qtd * rep)}</td>
                <td style="padding:7px 8px;text-align:right;font-weight:700;">${App.money(saldo)}</td>
            </tr>`;
        }).join('');

        const overlay = document.createElement('div');
        overlay.id = 'assPreviewOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,0.82);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 16px;';
        overlay.innerHTML = `
            <div style="background:#fff;width:100%;max-width:820px;border-radius:14px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.5);margin:auto;">

                <!-- Header -->
                <div style="background:#1e293b;color:#fff;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <strong style="font-size:15px;">Assinar recebimento da remessa</strong>
                        <div style="font-size:12px;color:#94a3b8;margin-top:2px;">${esc(r.codigo || '#' + r.id)} — ${esc(r.nome_loja || '-')}</div>
                    </div>
                    <button id="btnFecharPreviewAss" style="background:transparent;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;padding:4px 8px;">✕</button>
                </div>

                <!-- Corpo do documento -->
                <div style="padding:32px 40px;font-family:Arial,sans-serif;font-size:12px;color:#1e293b;max-height:calc(100vh - 180px);overflow-y:auto;">

                    <!-- Cabeçalho do documento -->
                    <div style="text-align:center;border-bottom:2px solid #1e293b;padding-bottom:14px;margin-bottom:20px;">
                        <div style="font-size:20px;font-weight:900;letter-spacing:1px;">PERSONALIZE Hub</div>
                        <div style="font-size:12px;font-weight:700;margin-top:4px;color:#475569;text-transform:uppercase;">Relatório de Remessa / Termo de Guarda</div>
                    </div>

                    <!-- Dados da remessa -->
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 24px;margin-bottom:18px;font-size:12px;">
                        <div><strong>Código:</strong> ${esc(r.codigo || '-')}</div>
                        <div><strong>Data:</strong> ${esc(r.data_formatada || new Date().toLocaleDateString('pt-BR'))}</div>
                        <div><strong>Loja:</strong> ${esc(r.nome_loja || '-')}</div>
                        <div><strong>Status:</strong> ${esc(r.status || '-')}</div>
                        ${r.responsavel ? `<div><strong>Responsável:</strong> ${esc(r.responsavel)}</div>` : ''}
                        ${r.telefone ? `<div><strong>Telefone:</strong> ${esc(r.telefone)}</div>` : ''}
                        <div style="color:#64748b;"><strong>Emitido em:</strong> ${new Date().toLocaleString('pt-BR')}</div>
                    </div>

                    <!-- Tabela de itens -->
                    <table style="width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:14px;">
                        <thead>
                            <tr style="background:#f1f5f9;">
                                <th style="padding:8px;text-align:left;border:1px solid #e2e8f0;">Produto</th>
                                <th style="padding:8px;text-align:center;border:1px solid #e2e8f0;white-space:nowrap;">Qtd</th>
                                <th style="padding:8px;text-align:center;border:1px solid #e2e8f0;white-space:nowrap;">Est.</th>
                                <th style="padding:8px;text-align:right;border:1px solid #e2e8f0;white-space:nowrap;">Consig./un</th>
                                <th style="padding:8px;text-align:right;border:1px solid #e2e8f0;white-space:nowrap;">Total orig.</th>
                                <th style="padding:8px;text-align:right;border:1px solid #e2e8f0;white-space:nowrap;">Saldo</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHTML}</tbody>
                    </table>

                    <!-- Totais -->
                    <div style="background:#f8fafc;border-radius:8px;padding:10px 16px;margin-bottom:18px;font-size:12.5px;">
                        <div style="display:flex;justify-content:space-between;"><span>Valor total original:</span><strong>${App.money(totalOriginal)}</strong></div>
                        <div style="display:flex;justify-content:space-between;margin-top:4px;border-top:1px solid #e2e8f0;padding-top:4px;"><span>Valor consignado em saldo:</span><strong>${App.money(totalSaldo)}</strong></div>
                    </div>

                    ${r.observacao ? `<div style="margin-bottom:16px;padding:10px 14px;border-left:3px solid #94a3b8;background:#f8fafc;font-size:11.5px;"><strong>Observação:</strong> ${esc(r.observacao)}</div>` : ''}

                    <!-- Termo de guarda -->
                    <div style="font-size:10.5px;color:#475569;line-height:1.6;padding:12px 14px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:28px;">
                        <strong style="color:#1e293b;display:block;margin-bottom:4px;">TERMO DE GUARDA E RESPONSABILIDADE</strong>
                        ${esc(TERMO_GUARDA)}
                    </div>

                    <!-- Seção de assinaturas -->
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:end;">

                        <!-- PERSONALIZE (linha vazia) -->
                        <div style="text-align:center;">
                            <div style="height:56px;"></div>
                            <div style="border-top:2px solid #334155;padding-top:8px;">
                                <div style="font-size:11px;font-weight:700;">Assinatura PERSONALIZE</div>
                                <div style="font-size:10px;color:#64748b;margin-top:2px;">Representante autorizado</div>
                            </div>
                        </div>

                        <!-- Loja parceira (canvas interativo) -->
                        <div>
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
                                <div>
                                    <label style="font-size:11px;font-weight:700;display:block;margin-bottom:3px;">Nome do responsável *</label>
                                    <input id="assPreviewNome" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;box-sizing:border-box;" placeholder="Nome completo">
                                </div>
                                <div>
                                    <label style="font-size:11px;font-weight:700;display:block;margin-bottom:3px;">CPF / CNPJ</label>
                                    <input id="assPreviewDoc" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;box-sizing:border-box;" placeholder="Documento">
                                </div>
                            </div>
                            <canvas id="canvasPreviewAssinatura" style="width:100%;height:130px;border:2px dashed #94a3b8;border-radius:10px;background:#fafafa;touch-action:none;cursor:crosshair;display:block;"></canvas>
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px;">
                                <span style="font-size:10.5px;color:#94a3b8;">Assine acima</span>
                                <button id="btnLimparPreviewAss" style="font-size:11px;background:none;border:1px solid #cbd5e1;border-radius:5px;padding:3px 10px;cursor:pointer;color:#64748b;">Limpar</button>
                            </div>
                            <div style="border-top:2px solid #334155;padding-top:8px;margin-top:10px;text-align:center;">
                                <div style="font-size:11px;font-weight:700;">Assinatura da Loja Parceira</div>
                                <div style="font-size:10px;color:#64748b;margin-top:2px;">Responsável pelo recebimento</div>
                            </div>
                        </div>

                    </div>

                    <p style="font-size:10px;color:#94a3b8;text-align:center;margin-top:16px;">Assinatura eletrônica simples para comprovação interna. Ao confirmar, o PDF com assinatura será gerado automaticamente.</p>
                </div>

                <!-- Footer -->
                <div style="padding:14px 24px;border-top:1px solid #e2e8f0;display:flex;gap:12px;justify-content:flex-end;background:#f8fafc;">
                    <button id="btnCancelarPreviewAss" style="padding:9px 20px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font-size:13px;font-weight:600;cursor:pointer;color:#475569;">Cancelar</button>
                    <button id="btnConfirmarAssinatura" style="padding:9px 22px;border:none;border-radius:8px;background:#16a34a;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">✓ Assinar e gerar PDF</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';

        const fechar = () => { overlay.remove(); document.body.style.overflow = ''; };
        document.getElementById('btnFecharPreviewAss').addEventListener('click', fechar);
        document.getElementById('btnCancelarPreviewAss').addEventListener('click', fechar);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });

        // Canvas: sincroniza dimensão interna com CSS para coordenadas exatas
        const canvas = document.getElementById('canvasPreviewAssinatura');
        requestAnimationFrame(() => {
            canvas.width  = canvas.clientWidth;
            canvas.height = canvas.clientHeight;
            setupCtx();
        });

        let ctx;
        function setupCtx() {
            ctx = canvas.getContext('2d');
            ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1e293b';
        }

        let desenhando = false;
        const getPos = (ev) => {
            const rect = canvas.getBoundingClientRect();
            const point = ev.touches ? ev.touches[0] : ev;
            // Sem escala — canvas interno == CSS agora
            return { x: point.clientX - rect.left, y: point.clientY - rect.top };
        };
        canvas.addEventListener('mousedown', (ev) => { ev.preventDefault(); desenhando = true; const p = getPos(ev); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
        canvas.addEventListener('mousemove', (ev) => { if (!desenhando) return; ev.preventDefault(); const p = getPos(ev); ctx.lineTo(p.x, p.y); ctx.stroke(); });
        window.addEventListener('mouseup', () => { desenhando = false; });
        canvas.addEventListener('touchstart', (ev) => { ev.preventDefault(); desenhando = true; const p = getPos(ev); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { passive: false });
        canvas.addEventListener('touchmove', (ev) => { if (!desenhando) return; ev.preventDefault(); const p = getPos(ev); ctx.lineTo(p.x, p.y); ctx.stroke(); }, { passive: false });
        canvas.addEventListener('touchend', () => { desenhando = false; });
        document.getElementById('btnLimparPreviewAss').addEventListener('click', () => { if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); });

        document.getElementById('btnConfirmarAssinatura').addEventListener('click', async () => {
            const nome = document.getElementById('assPreviewNome')?.value?.trim();
            const documento = document.getElementById('assPreviewDoc')?.value?.trim();
            if (!nome || nome.length < 3) { App.toast('warning', 'Informe o nome do responsável (mínimo 3 caracteres).'); return; }
            const assinatura_base64 = canvas.toDataURL('image/png');
            const btnConfirmar = document.getElementById('btnConfirmarAssinatura');
            btnConfirmar.disabled = true;
            btnConfirmar.textContent = 'Salvando…';
            try {
                const result = await App.api(`/remessas/${id}/assinar`, {
                    method: 'POST',
                    body: JSON.stringify({ nome_responsavel: nome, documento_responsavel: documento || '', assinatura_base64 })
                });
                App.toast('success', result.mensagem || 'Remessa assinada com sucesso!');

                // Assinatura disponível em memória — gera PDF direto sem re-fetch
                const assinatura = {
                    nome_responsavel: nome,
                    documento_responsavel: documento || '',
                    assinatura_base64,
                    data_assinatura_formatada: new Date().toLocaleString('pt-BR')
                };
                fechar();
                await carregarDadosLoja();
                const dados = await App.api(`/remessas/${id}`);
                await gerarPDF({
                    titulo: 'RELATÓRIO DE REMESSA / TERMO DE GUARDA',
                    codigo: dados.remessa.codigo || `REMESSA #${dados.remessa.id}`,
                    loja: dados.remessa,
                    itens: dados.itens,
                    observacao: dados.remessa.observacao || '',
                    data: dados.remessa.data_formatada,
                    status: dados.remessa.status,
                    assinatura
                });
            } catch (err) {
                App.toast('error', err.message);
                btnConfirmar.disabled = false;
                btnConfirmar.textContent = '✓ Assinar e gerar PDF';
            }
        });
    }

    async function gerarPDFEstoqueAtual() {
        if (!parceiroDestino.value) return App.toast('warning', 'Selecione uma loja.');
        if (!estoqueAtual.length) return App.toast('warning', 'Não há itens para o relatório.');
        const loja = parceiros.find(p => String(p.id) === String(parceiroDestino.value));
        const itens = estoqueAtual.map(i => ({
            produto_nome: i.produto_nome,
            variacao: i.variacao,
            imagem_url: i.imagem_url,
            quantidade: i.quantidade_atual,
            quantidade_estornada: 0,
            preco_repasse_snapshot: i.preco_repasse,
            valor_saldo: i.valor_consignado_atual
        }));
        await gerarPDF({
            titulo: 'RELATÓRIO DE ESTOQUE CONSIGNADO / TERMO DE GUARDA',
            codigo: 'ESTOQUE ATUAL',
            loja,
            itens,
            observacao: 'Relatório gerado com base no saldo atual consignado da loja.'
        });
    }

    async function gerarPDFRemessa(id) {
        try {
            const dados = await App.api(`/remessas/${id}`);
            const assinatura = await App.api(`/remessas/${id}/assinatura`).catch(() => null);
            await gerarPDF({
                titulo: 'RELATÓRIO DE REMESSA / TERMO DE GUARDA',
                codigo: dados.remessa.codigo || `REMESSA #${dados.remessa.id}`,
                loja: dados.remessa,
                itens: dados.itens,
                observacao: dados.remessa.observacao || '',
                data: dados.remessa.data_formatada,
                status: dados.remessa.status,
                assinatura
            });
        } catch (err) { App.toast('error', err.message); }
    }

    async function gerarPDF({ titulo, codigo, loja, itens, observacao, data, status, assinatura = null }) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        const qtdItem = (i) => Number(i.quantidade || i.quantidade_enviada || 0);
        const repasseItem = (i) => Number(i.preco_repasse_snapshot || i.preco_repasse_unitario || i.preco_repasse || 0);
        const totalOriginal = itens.reduce((s, i) => s + qtdItem(i) * repasseItem(i), 0);
        const totalSaldo = itens.reduce((s, i) => s + Number(i.valor_saldo || i.valor_total_saldo || ((qtdItem(i) - Number(i.quantidade_estornada || 0)) * repasseItem(i)) || 0), 0);
        const imagens = {};
        for (let idx = 0; idx < itens.length; idx++) imagens[idx] = await App.imageToDataURL(itens[idx].imagem_url);

        doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('PERSONALIZE Hub', 105, 16, { align: 'center' });
        doc.setFontSize(12); doc.text(titulo, 105, 25, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
        doc.text(`Código: ${codigo || '-'}`, 14, 38);
        doc.text(`Loja: ${loja?.nome_loja || '-'}`, 14, 44);
        doc.text(`Responsável: ${loja?.responsavel || '-'}`, 14, 50);
        doc.text(`Telefone: ${loja?.telefone || '-'}`, 14, 56);
        doc.text(`Data: ${data || new Date().toLocaleString('pt-BR')}`, 120, 38);
        if (status) doc.text(`Status: ${status}`, 120, 44);
        doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`, 120, 50);

        const body = itens.map(i => [
            '',
            `${i.produto_nome || '-'}\n${i.variacao || ''}`,
            String(qtdItem(i)),
            String(i.quantidade_estornada || 0),
            App.money(repasseItem(i)),
            App.money(qtdItem(i) * repasseItem(i)),
            App.money(i.valor_saldo || i.valor_total_saldo || ((qtdItem(i) - Number(i.quantidade_estornada || 0)) * repasseItem(i)) || 0)
        ]);

        doc.autoTable({
            startY: 64,
            head: [['Foto', 'Produto', 'Qtd', 'Est.', 'Valor cons.', 'Total original', 'Saldo']],
            body,
            theme: 'grid',
            rowPageBreak: 'avoid',
            styles: { fontSize: 7.5, cellPadding: 2, minCellHeight: 18, valign: 'middle', overflow: 'linebreak' },
            columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 58 }, 2: { halign: 'center', cellWidth: 14 }, 3: { halign: 'center', cellWidth: 14 }, 4: { halign: 'right', cellWidth: 25 }, 5: { halign: 'right', cellWidth: 28 }, 6: { halign: 'right', cellWidth: 28 } },
            didDrawCell: (data) => {
                if (data.section === 'body' && data.column.index === 0) {
                    const img = imagens[data.row.index];
                    if (img) doc.addImage(img, 'JPEG', data.cell.x + 2, data.cell.y + 2, 13, 13);
                }
            }
        });

        let y = (doc.lastAutoTable?.finalY || 64) + 8;
        const ensure = (h) => { if (y + h > 280) { doc.addPage(); y = 18; } };
        ensure(22);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
        doc.text(`VALOR TOTAL ORIGINAL: ${App.money(totalOriginal)}`, 14, y); y += 7;
        doc.text(`VALOR CONSIGNADO EM SALDO: ${App.money(totalSaldo)}`, 14, y); y += 10;
        if (observacao) {
            ensure(12);
            doc.setFont('helvetica', 'bold'); doc.text('Observação', 14, y); y += 6;
            doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
            const obsLines = doc.splitTextToSize(observacao, 182);
            for (const linha of obsLines) { ensure(6); doc.text(linha, 14, y); y += 5; }
            y += 4;
        }

        const termo = 'TERMO DE GUARDA E RESPONSABILIDADE: ' + TERMO_GUARDA;
        ensure(12);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Termo de guarda', 14, y); y += 6;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        const linhas = doc.splitTextToSize(termo, 182);
        for (const linha of linhas) { ensure(6); doc.text(linha, 14, y); y += 5; }
        if (assinatura) {
            ensure(38);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Assinatura digital de recebimento', 14, y); y += 6;
            doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
            doc.text(`Assinado por: ${assinatura.nome_responsavel || '-'}`, 14, y); y += 5;
            doc.text(`Documento: ${assinatura.documento_responsavel || '-'}`, 14, y); y += 5;
            doc.text(`Data/hora: ${assinatura.data_assinatura_formatada || '-'}`, 14, y); y += 3;
            try { doc.addImage(assinatura.assinatura_base64, 'PNG', 122, y - 18, 60, 24); } catch (err) { console.warn('Assinatura não inserida no PDF:', err.message); }
            y += 22;
        }
        ensure(34);
        y += 16;
        doc.line(18, y, 88, y); doc.line(122, y, 192, y);
        y += 5;
        doc.text('Assinatura PERSONALIZE', 53, y, { align: 'center' });
        doc.text(assinatura ? 'Assinatura digital da Loja Parceira' : 'Assinatura Loja Parceira', 157, y, { align: 'center' });
        doc.save(`${codigo || 'relatorio_remessa'}.pdf`.replace(/[\s/\\]+/g, '_'));
    }

    document.getElementById('btnPdfEstoque').addEventListener('click', gerarPDFEstoqueAtual);
    carregarBase().catch(err => App.toast('error', err.message));
});
