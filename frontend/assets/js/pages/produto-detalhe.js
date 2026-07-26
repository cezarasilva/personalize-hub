(() => {
    const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = v => fmt.format(Number(v || 0));
    const q = id => document.getElementById(id);

    const params = new URLSearchParams(location.search);
    const slug = params.get('loja') || 'personalize';
    const produtoId = params.get('id');
    const variacaoId = params.get('vid');

    function urlCatalogo() {
        return `/catalogo/${encodeURIComponent(slug)}`;
    }

    // --- Renderizador de specs (HTML do Quill ou markdown legado) ---
    function renderSpecs(text) {
        if (!text || !text.trim()) return '';
        const trimmed = text.trim();

        // Conteúdo HTML gerado pelo Quill — renderiza direto
        if (trimmed.startsWith('<')) return trimmed;

        // Fallback: parser de markdown simples (conteúdo legado)
        const lines = trimmed.split('\n');
        let html = '';
        let inList = false;
        for (const line of lines) {
            const t = line.trim();
            if (!t) { if (inList) { html += '</ul>'; inList = false; } continue; }
            if (t.startsWith('# ')) {
                if (inList) { html += '</ul>'; inList = false; }
                html += `<h2 class="specs-h1">${esc(t.slice(2))}</h2>`;
            } else if (t.startsWith('## ')) {
                if (inList) { html += '</ul>'; inList = false; }
                html += `<h3 class="specs-h2">${esc(t.slice(3))}</h3>`;
            } else if (t.startsWith('- ') || t.startsWith('• ')) {
                if (!inList) { html += '<ul class="specs-list">'; inList = true; }
                html += `<li>${esc(t.slice(2)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</li>`;
            } else {
                if (inList) { html += '</ul>'; inList = false; }
                html += `<p class="specs-p">${esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`;
            }
        }
        if (inList) html += '</ul>';
        return html;
    }

    // --- Galeria ---
    let imgs = [];
    let imgIdx = 0;

    window._detGal = function (delta) {
        imgIdx = (imgIdx + delta + imgs.length) % imgs.length;
        atualizarGaleria();
    };

    window._detThumb = function (i) {
        imgIdx = i;
        atualizarGaleria();
    };

    function atualizarGaleria() {
        const mainImg = q('detMainImg');
        const count = q('detImgCount');
        if (mainImg) mainImg.src = imgs[imgIdx] || '';
        if (count) count.textContent = `${imgIdx + 1} / ${imgs.length}`;
        document.querySelectorAll('.det-thumb').forEach((t, i) => t.classList.toggle('active', i === imgIdx));
    }

    function renderGaleria(produto) {
        const galeria = Array.isArray(produto.imagens) ? produto.imagens.filter(Boolean) : [];
        if (!galeria.length && produto.imagem_url) galeria.push(produto.imagem_url);
        imgs = galeria;
        imgIdx = 0;

        const el = q('detGaleriaCol');
        if (!el) return;

        el.innerHTML = `
            <div class="det-gallery">
                <div class="det-main-img-wrap">
                    ${imgs.length ? `
                        <img id="detMainImg" src="${esc(imgs[0])}" alt="${esc(produto.nome)}">
                        ${imgs.length > 1 ? `
                            <button class="det-nav det-nav-prev" onclick="window._detGal(-1)" aria-label="Anterior">
                                <i class="bx bx-chevron-left"></i>
                            </button>
                            <button class="det-nav det-nav-next" onclick="window._detGal(1)" aria-label="Próxima">
                                <i class="bx bx-chevron-right"></i>
                            </button>
                            <span class="det-img-count" id="detImgCount">1 / ${imgs.length}</span>
                        ` : ''}
                    ` : `<div class="det-sem-foto"><i class="bx bx-image-alt"></i><span>Sem foto</span></div>`}
                </div>
                ${imgs.length > 1 ? `
                    <div class="det-thumbs">
                        ${imgs.map((url, i) => `
                            <button class="det-thumb ${i === 0 ? 'active' : ''}" onclick="window._detThumb(${i})" aria-label="Foto ${i + 1}">
                                <img src="${esc(url)}" alt="Foto ${i + 1}">
                            </button>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    // --- Variações / tabela de preço por quantidade (mesmo padrão do catalogo-publico.js) ---

    function variacoesDoProduto(p) {
        if (Array.isArray(p.variacoes) && p.variacoes.length) return p.variacoes;
        return [{ variacao_id: p.variacao_id, variacao: p.variacao, preco_publico: p.preco_publico, precos_qtd: [] }];
    }

    function opcoesQtd(variacao) {
        if (Array.isArray(variacao.precos_qtd) && variacao.precos_qtd.length) return variacao.precos_qtd;
        return [{ quantidade: 1, preco_unitario: variacao.preco_publico }];
    }

    function temSeletor(p) {
        const vs = variacoesDoProduto(p);
        return vs.length > 1 || vs.some(v => Array.isArray(v.precos_qtd) && v.precos_qtd.length > 0);
    }

    // Lê o eixos_json de cada variação (gerado pelo "Gerar variações" do
    // cadastro). Se TODAS as variações tiverem eixos válidos, retorna um mapa
    // {NomeDoEixo: [valores únicos]} para montar seletores separados (chips).
    // Se alguma variação não tiver (produto simples/legado), retorna null —
    // cai no <select> único de sempre, sem regressão.
    function parseEixos(v) {
        try {
            const e = typeof v.eixos_json === 'string' ? JSON.parse(v.eixos_json) : v.eixos_json;
            return e && typeof e === 'object' ? e : null;
        } catch { return null; }
    }

    function eixosDasVariacoes(vs) {
        const parsed = vs.map(parseEixos);
        if (vs.length < 2 || parsed.some(e => !e)) return null;
        const eixos = {};
        parsed.forEach(combo => {
            Object.entries(combo).forEach(([nome, valor]) => {
                if (!eixos[nome]) eixos[nome] = [];
                if (!eixos[nome].includes(valor)) eixos[nome].push(valor);
            });
        });
        return Object.keys(eixos).length ? eixos : null;
    }

    function encontrarVariacaoPorEixos(vs, selecao) {
        return vs.find(v => {
            const e = parseEixos(v);
            if (!e) return false;
            return Object.keys(selecao).every(k => String(e[k]) === String(selecao[k]));
        });
    }

    function formatarVendidos(n) {
        const total = Number(n || 0);
        if (total <= 0) return '';
        if (total < 5) return `${total} vendido${total === 1 ? '' : 's'}`;
        const faixas = [1000, 500, 100, 50, 25, 10, 5];
        const faixa = faixas.find(f => total >= f) || 5;
        return `+${faixa} vendidos`;
    }

    let _variacaoAtualId = null;

    function renderInfo(produto, loja) {
        const el = q('detInfoCol');
        if (!el) return;

        const whats = String(loja.whatsapp_catalogo || loja.telefone || '').replace(/\D/g, '');
        const vs = variacoesDoProduto(produto);
        const comSel = temSeletor(produto);
        const eixosMap = eixosDasVariacoes(vs);
        const variacaoInicial = vs.find(v => Number(v.variacao_id) === Number(variacaoId)) || vs[0];
        const precoInicial = variacaoInicial.preco_publico;
        _variacaoAtualId = variacaoInicial.variacao_id;

        const msgWa = `Olá! Tenho interesse no produto: *${produto.nome}*${produto.variacao ? ' (' + produto.variacao + ')' : ''}. Preço: ${money(precoInicial)}`;
        const waLink = whats ? `https://wa.me/55${whats}?text=${encodeURIComponent(msgWa)}` : null;

        const estoque = produto.estoque_central !== null ? Number(produto.estoque_central) : null;
        const vendidosTxt = formatarVendidos(produto.total_vendido);

        let seletorHtml;
        if (eixosMap) {
            const selecaoInicial = parseEixos(variacaoInicial) || {};
            seletorHtml = `
                <div class="det-eixos" id="detEixos">
                    ${Object.entries(eixosMap).map(([nomeEixo, valores]) => `
                        <div class="det-eixo-grupo">
                            <label>${esc(nomeEixo)}</label>
                            <div class="det-eixo-chips">
                                ${valores.map(v => `<button type="button" class="det-eixo-chip${selecaoInicial[nomeEixo] === v ? ' active' : ''}" data-eixo="${esc(nomeEixo)}" data-valor="${esc(v)}" onclick="window._detEixoSelecionar(this)">${esc(v)}</button>`).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="form-group mt-2"><label>Quantidade</label>
                    <select id="detSelQtd" onchange="window._detQtdChange()">
                        ${opcoesQtd(variacaoInicial).map(f => `<option value="${f.quantidade}" data-preco="${f.preco_unitario}">${f.quantidade} un.</option>`).join('')}
                    </select>
                </div>`;
        } else if (comSel) {
            seletorHtml = `
            <div class="det-seletores" id="detSeletores">
                ${vs.length > 1 ? `
                <div class="form-group"><label>Tamanho/variação</label>
                    <select id="detSelTamanho" onchange="window._detTamanhoChange()">
                        ${vs.map((v, i) => `<option value="${i}">${esc(v.variacao || 'Padrão')}</option>`).join('')}
                    </select>
                </div>` : ''}
                <div class="form-group"><label>Quantidade</label>
                    <select id="detSelQtd" onchange="window._detQtdChange()">
                        ${opcoesQtd(vs[0]).map(f => `<option value="${f.quantidade}" data-preco="${f.preco_unitario}">${f.quantidade} un.</option>`).join('')}
                    </select>
                </div>
            </div>`;
        } else {
            seletorHtml = '';
        }

        el.innerHTML = `
            <div class="det-info">
                ${produto.categoria ? `<span class="det-cat-pill">${esc(produto.categoria)}</span>` : ''}
                <h1 class="det-produto-nome">${esc(produto.nome)}</h1>
                ${produto.variacao ? `<p class="det-produto-var">${esc(produto.variacao)}</p>` : ''}
                ${vendidosTxt ? `<p class="det-vendidos"><i class="bx bx-trending-up"></i> ${esc(vendidosTxt)}</p>` : ''}

                ${seletorHtml}

                <div class="det-preco-wrap">
                    <span class="det-preco" id="detPreco">${money(precoInicial)}</span>
                </div>

                ${produto.descricao ? `<p class="det-desc-curta">${esc(produto.descricao)}</p>` : ''}

                <div class="det-tags">
                    ${estoque !== null && estoque > 0 ? `<span class="det-tag success"><i class="bx bx-check-circle"></i> Em estoque</span>` : ''}
                    ${estoque === 0 ? `<span class="det-tag muted"><i class="bx bx-time"></i> Sob encomenda</span>` : ''}
                    ${produto.lead_time_dias > 0 ? `<span class="det-tag muted"><i class="bx bx-time-five"></i> Prazo: ${produto.lead_time_dias} dia(s)</span>` : ''}
                    ${produto.qtd_minima > 1 ? `<span class="det-tag muted"><i class="bx bx-package"></i> Mín. ${produto.qtd_minima} un.</span>` : ''}
                </div>

                <div class="det-divider"></div>

                <div class="det-actions">
                    <button class="det-btn-cart" id="detBtnCart" onclick="window._detAdd()">
                        <i class="bx bx-cart-add"></i> Adicionar ao carrinho
                    </button>
                    ${waLink ? `
                        <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="det-btn-wa">
                            <i class="bx bxl-whatsapp"></i> Pedir pelo WhatsApp
                        </a>
                    ` : ''}
                </div>

                <div class="det-add-ok" id="detAddOk" style="display:none">
                    <i class="bx bx-check-circle"></i>
                    <span>Adicionado ao carrinho!</span>
                    <a href="${urlCatalogo()}">Ver carrinho →</a>
                </div>
            </div>
        `;

        _produtoAtual = produto;
    }

    let _produtoAtual = null;

    window._detTamanhoChange = function () {
        if (!_produtoAtual) return;
        const vs = variacoesDoProduto(_produtoAtual);
        const idx = Number(q('detSelTamanho')?.value || 0);
        const variacao = vs[idx] || vs[0];
        _variacaoAtualId = variacao.variacao_id;
        const selQtd = q('detSelQtd');
        if (selQtd) selQtd.innerHTML = opcoesQtd(variacao).map(f => `<option value="${f.quantidade}" data-preco="${f.preco_unitario}">${f.quantidade} un.</option>`).join('');
        const preco = q('detPreco');
        if (preco) preco.textContent = money(variacao.preco_publico);
    };

    // Seleção por eixo separado (ex.: Cor e Tamanho independentes). Atualiza
    // só o grupo do eixo clicado e recompõe a seleção lendo todos os grupos.
    window._detEixoSelecionar = function (btn) {
        if (!_produtoAtual) return;
        const vs = variacoesDoProduto(_produtoAtual);

        btn.closest('.det-eixo-grupo')?.querySelectorAll('.det-eixo-chip').forEach(c => c.classList.toggle('active', c === btn));

        const selecao = {};
        document.querySelectorAll('#detEixos .det-eixo-grupo').forEach(grupo => {
            const ativo = grupo.querySelector('.det-eixo-chip.active');
            if (ativo) selecao[ativo.dataset.eixo] = ativo.dataset.valor;
        });

        const variacao = encontrarVariacaoPorEixos(vs, selecao);
        if (!variacao) return; // combinação ainda incompleta ou indisponível

        _variacaoAtualId = variacao.variacao_id;
        const selQtd = q('detSelQtd');
        if (selQtd) selQtd.innerHTML = opcoesQtd(variacao).map(f => `<option value="${f.quantidade}" data-preco="${f.preco_unitario}">${f.quantidade} un.</option>`).join('');
        const preco = q('detPreco');
        if (preco) preco.textContent = money(variacao.preco_publico);
    };

    window._detQtdChange = function () {
        const sel = q('detSelQtd');
        const preco = q('detPreco');
        if (sel && preco) preco.textContent = money(sel.selectedOptions[0]?.dataset.preco);
    };

    window._detAdd = function () {
        const selQtd = q('detSelQtd');
        const qtdSelecionada = selQtd ? Number(selQtd.value || 1) : 1;
        const vidSelecionado = _variacaoAtualId != null ? Number(_variacaoAtualId) : Number(variacaoId);

        const pending = JSON.parse(localStorage.getItem('catalogoPending') || '[]');
        pending.push({ produto_id: Number(produtoId), variacao_id: vidSelecionado, quantidade: qtdSelecionada });
        localStorage.setItem('catalogoPending', JSON.stringify(pending));
        const btn = q('detBtnCart');
        const ok = q('detAddOk');
        if (btn) btn.style.display = 'none';
        if (ok) ok.style.display = 'flex';
    };

    function render(data) {
        const { loja, produto } = data;

        document.title = `${produto.nome} — ${loja.nome_loja || 'Catálogo'}`;
        const pageTitle = q('pageTitle');
        if (pageTitle) pageTitle.textContent = document.title;

        // Topbar
        const topNome = q('topbarNome');
        const topLogo = q('topbarLogo');
        if (topNome) topNome.textContent = loja.nome_loja || 'Catálogo';
        if (topLogo && loja.logo_url) { topLogo.src = loja.logo_url; topLogo.style.display = 'inline-block'; }

        const whats = String(loja.whatsapp_catalogo || loja.telefone || '').replace(/\D/g, '');
        const topWa = q('topbarWhatsapp');
        if (whats && topWa) { topWa.href = `https://wa.me/55${whats}`; topWa.style.display = ''; }

        // Cores da loja
        if (loja.cor_titulo || loja.cor_tema) document.body.style.setProperty('--catalogo-title-color', loja.cor_titulo || loja.cor_tema);
        if (loja.cor_preco) document.body.style.setProperty('--catalogo-price-color', loja.cor_preco);
        if (loja.cor_botao || loja.cor_tema) document.body.style.setProperty('--catalogo-button-color', loja.cor_botao || loja.cor_tema);

        // Links de volta
        const catalogoUrl = urlCatalogo();
        [q('btnVoltar'), q('detalheBrand'), q('detBreadBack'), q('detVoltarBottom'), q('detErroVoltar')].forEach(a => { if (a) a.href = catalogoUrl; });

        // WhatsApp flutuante
        const floatWa = q('whatsappFloat');
        if (whats && floatWa) { floatWa.href = `https://wa.me/55${whats}`; floatWa.style.display = 'flex'; }

        // Breadcrumb
        const breadNome = q('detBreadNome');
        if (breadNome) breadNome.textContent = produto.nome;

        // Galeria
        renderGaleria(produto);

        // Info
        renderInfo(produto, loja);

        // Especificações
        if (produto.descricao_longa && produto.descricao_longa.trim()) {
            const specsEl = q('detSpecsSection');
            const specsBody = q('detSpecsBody');
            if (specsBody) specsBody.innerHTML = renderSpecs(produto.descricao_longa);
            if (specsEl) specsEl.style.display = '';
        }

        // Mostrar conteúdo
        q('detLoading').style.display = 'none';
        q('detConteudo').style.display = '';
    }

    async function init() {
        if (!produtoId) {
            q('detLoading').style.display = 'none';
            const e = q('detErro'); if (e) e.style.display = '';
            const m = q('detErroMsg'); if (m) m.textContent = 'Produto não especificado.';
            const v = q('detErroVoltar'); if (v) v.href = urlCatalogo();
            return;
        }
        try {
            const res = await fetch(`/api/catalogo-publico/${encodeURIComponent(slug)}/produto/${produtoId}`);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.erro || 'Produto não encontrado.');
            }
            render(await res.json());
        } catch (e) {
            q('detLoading').style.display = 'none';
            const errEl = q('detErro'); if (errEl) errEl.style.display = '';
            const msgEl = q('detErroMsg'); if (msgEl) msgEl.textContent = e.message;
            const vol = q('detErroVoltar'); if (vol) vol.href = urlCatalogo();
        }
    }

    init();
})();
