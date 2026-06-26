document.addEventListener('DOMContentLoaded', () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('produtos-cadastro');

    // =========================================================
    // TIPOS DE OFERTA
    // =========================================================
    const TIPOS = [
        { id: 'PRODUTO_PROPRIO',  icon: 'bx-package',    label: 'Produto Próprio',   desc: 'Fabricado por você. Vai para estoque ou entrega.', destinos: ['ESTOQUE','ENTREGA','REMESSA'] },
        { id: 'SOB_ENCOMENDA',    icon: 'bx-time',       label: 'Sob Encomenda',     desc: 'Produzido após pedido do cliente, com prazo.', destinos: ['ENTREGA','REMESSA'] },
        { id: 'SERVICO',          icon: 'bx-wrench',     label: 'Serviço',           desc: 'Prestação de serviço com horas e escopo definidos.', destinos: ['CONCLUIDO'] },
        { id: 'PROJETO_DIGITAL',  icon: 'bx-code-alt',   label: 'Projeto Digital',   desc: 'Site, app, sistema ou entregável digital.', destinos: ['CONCLUIDO','ENTREGA'] },
        { id: 'REVENDA',          icon: 'bx-store',      label: 'Revenda',           desc: 'Comprado de fornecedor e revendido com margem.', destinos: ['ESTOQUE','ENTREGA'] },
        { id: 'PACOTE',           icon: 'bx-gift',       label: 'Pacote / Combo',    desc: 'Combinação de produtos ou serviços com desconto.', destinos: ['ESTOQUE','ENTREGA','REMESSA','CONCLUIDO'] },
    ];

    const DESTINOS = [
        { id: 'ESTOQUE',   icon: 'bx-archive',   label: 'Estoque',         desc: 'Entra no estoque central ao ser concluído.' },
        { id: 'ENTREGA',   icon: 'bx-package',   label: 'Entrega direta',  desc: 'Enviado diretamente ao cliente final.' },
        { id: 'REMESSA',   icon: 'bx-transfer',  label: 'Remessa parceiro',desc: 'Enviado para loja parceira / consignado.' },
        { id: 'CONCLUIDO', icon: 'bx-check-circle', label: 'Concluído',    desc: 'Serviço entregue — sem movimentação de estoque.' },
    ];

    // =========================================================
    // ESTADO
    // =========================================================
    let stepAtual   = 1;
    let tipoAtivo   = 'PRODUTO_PROPRIO';
    let destinoAtivo = 'ESTOQUE';
    let statusFluxo = 'ATIVO';
    let editandoId  = null;
    let maquinas    = [];
    let insumos     = [];

    // Variações deste produto (cada uma com sua própria precificação e tabela de preço por quantidade)
    let variacoesMultiplas  = []; // { id, variacaoId, variacao, sku, preco_venda, precosQtd: [{id, quantidade, preco}], precItens, quantidadeProduzida, eixos }
    let variacaoModalId       = null;  // id da variação aberta no modal de edição
    let _variacaoModalEraNova = false; // true se foi criada agora (cancelar = descartar)
    let _varMultId = 0;
    function nextVarMultId() { return ++_varMultId; }
    let _faixaId = 0;
    function nextFaixaId() { return ++_faixaId; }
    let _precItemId = 0;
    function nextPrecId() { return ++_precItemId; }

    // Eixos de variação (ex.: Tamanho, Cor) — gerador em lote por cima de variacoesMultiplas
    let eixosProduto = []; // { id, nome, valores: [string, ...] }
    let _eixoId = 0;
    function nextEixoId() { return ++_eixoId; }

    // editor rico
    let quillEditor = null;
    if (typeof Quill !== 'undefined' && document.getElementById('editorDescLonga')) {
        quillEditor = new Quill('#editorDescLonga', {
            theme: 'snow',
            placeholder: 'Adicione especificações, materiais, dimensões, observações técnicas...',
            modules: {
                toolbar: [
                    [{ header: [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ color: [] }, { background: [] }],
                    [{ list: 'ordered' }, { list: 'bullet' }],
                    [{ indent: '-1' }, { indent: '+1' }],
                    ['blockquote', 'code-block'],
                    ['link'],
                    ['clean'],
                ]
            }
        });
    }

    // crop
    let cropperProduto  = null;
    let cropObjectUrl   = null;
    let arquivoAtualCrop = null;
    let filaCrop        = [];
    let totalFilaCrop   = 0;

    // galeria interativa
    let galeriaItems = []; // { id, file|null, url, isUrl }
    let _galeriaId   = 0;
    function nextGalId() { return ++_galeriaId; }

    const esc  = App.escapeHtml;
    const $    = (id) => document.getElementById(id);
    const money = App.money;

    function moedaNum(id) { return Number(String($( id)?.value || '0').replace(',', '.')) || 0; }
    function setVal(id, v) { const el = $(id); if (el) el.value = Number(v || 0).toFixed(2); }

    // =========================================================
    // WIZARD — NAVEGAÇÃO
    // =========================================================
    function irPasso(n) {
        if (!validarPasso(stepAtual)) return;
        stepAtual = n;
        renderPasso();
    }

    function validarPasso(p) {
        if (p === 1 && !tipoAtivo) { App.toast('warning', 'Selecione o tipo de oferta.'); return false; }
        if (p === 2) {
            if (!$('nome')?.value.trim()) { App.toast('warning', 'Informe o nome do produto.'); return false; }
            if (!variacoesMultiplas.length) { App.toast('warning', 'Adicione ao menos uma variação ("+ Adicionar variação").'); return false; }
        }
        return true;
    }

    function renderPasso() {
        document.querySelectorAll('.wizard-section').forEach((s, i) => s.classList.toggle('active', i + 1 === stepAtual));
        document.querySelectorAll('[data-dot]').forEach(dot => {
            const n = Number(dot.dataset.dot);
            dot.classList.toggle('active', n === stepAtual);
            dot.classList.toggle('done',   n < stepAtual);
        });
        if (stepAtual === 3) renderStep3();
        if (stepAtual === 4) renderStep4();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // =========================================================
    // PASSO 1 — TIPO DE OFERTA
    // =========================================================
    function renderTipos() {
        const grid = $('ofertaGrid');
        if (!grid) return;
        grid.innerHTML = TIPOS.map(t => `
            <button type="button" class="oferta-card${tipoAtivo === t.id ? ' selected' : ''}" data-tipo="${t.id}">
                <div class="oferta-card-icon"><i class="bx ${t.icon}"></i></div>
                <strong>${esc(t.label)}</strong>
                <small>${esc(t.desc)}</small>
            </button>`).join('');
        grid.querySelectorAll('.oferta-card').forEach(card => {
            card.addEventListener('click', () => {
                tipoAtivo = card.dataset.tipo;
                $('tipo_oferta').value = tipoAtivo;
                // Ajusta destino padrão para o tipo
                const tipo = TIPOS.find(t => t.id === tipoAtivo);
                destinoAtivo = tipo?.destinos[0] || 'ESTOQUE';
                $('destino_final').value = destinoAtivo;
                renderTipos();
            });
        });
    }

    // =========================================================
    // BADGES de tipo
    // =========================================================
    function renderBadge(elId) {
        const el = $(elId);
        if (!el) return;
        const tipo = TIPOS.find(t => t.id === tipoAtivo);
        if (!tipo) return;
        el.innerHTML = `<i class="bx ${tipo.icon}"></i> ${esc(tipo.label)}`;
    }

    // =========================================================
    // PASSO 2 — CATEGORIA (dropdown com "+ Adicionar categoria")
    // =========================================================
    async function carregarCategorias(selecionada) {
        const sel = $('categoria');
        if (!sel) return;
        let cats = [];
        try { cats = await App.api('/produtos/categorias'); } catch { cats = []; }
        sel.innerHTML = '<option value="">Selecione...</option>' +
            cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
        if (selecionada) {
            if (!cats.includes(selecionada)) {
                sel.insertAdjacentHTML('beforeend', `<option value="${esc(selecionada)}">${esc(selecionada)}</option>`);
            }
            sel.value = selecionada;
        }
    }

    // Botão "+" dedicado: independe do valor atual do select (o evento
    // "change" nativo não dispara se o usuário reselecionar a mesma opção
    // já ativa — por isso um botão de clique direto é mais confiável aqui).
    $('btnAddCategoria')?.addEventListener('click', async () => {
        const sel = $('categoria');
        if (!sel) return;
        const { value: nova } = await Swal.fire({
            title: 'Nova categoria',
            input: 'text',
            inputPlaceholder: 'Ex.: Canecas',
            showCancelButton: true,
            confirmButtonText: 'Adicionar',
            cancelButtonText: 'Cancelar',
        });
        const cat = (nova || '').trim();
        if (!cat) return;
        if (![...sel.options].some(o => o.value === cat)) {
            sel.insertAdjacentHTML('beforeend', `<option value="${esc(cat)}">${esc(cat)}</option>`);
        }
        sel.value = cat;
    });

    // =========================================================
    // PASSO 2 — EIXOS DE VARIAÇÃO (Tamanho, Cor...) — gerador em lote
    // =========================================================
    function renderEixos() {
        const el = $('listaEixos');
        if (!el) return;
        if (!eixosProduto.length) { el.innerHTML = ''; return; }
        el.innerHTML = eixosProduto.map(eixo => `
            <div class="eixo-card" data-eixo="${eixo.id}">
                <div class="eixo-card-header">
                    <strong>${esc(eixo.nome)}</strong>
                    <button type="button" class="icon-btn" title="Remover eixo" onclick="window._eixoRemover(${eixo.id})"><i class="bx bx-trash"></i></button>
                </div>
                <div class="eixo-valores">
                    ${eixo.valores.map(v => `
                        <span class="eixo-valor-chip">${esc(v)}
                            <button type="button" onclick="window._eixoValorRemover(${eixo.id}, ${JSON.stringify(v)})"><i class="bx bx-x"></i></button>
                        </span>
                    `).join('')}
                    <span class="eixo-valor-add">
                        <input type="text" id="novoValorEixo_${eixo.id}" placeholder="Novo valor">
                        <button type="button" class="btn btn-small" onclick="window._eixoValorAdicionar(${eixo.id})"><i class="bx bx-plus"></i></button>
                    </span>
                </div>
            </div>
        `).join('');
    }

    window._eixoRemover = (id) => {
        eixosProduto = eixosProduto.filter(e => e.id !== id);
        renderEixos();
    };
    window._eixoValorRemover = (eixoId, valor) => {
        const eixo = eixosProduto.find(e => e.id === eixoId);
        if (!eixo) return;
        eixo.valores = eixo.valores.filter(v => v !== valor);
        renderEixos();
    };
    window._eixoValorAdicionar = (eixoId) => {
        const eixo = eixosProduto.find(e => e.id === eixoId);
        if (!eixo) return;
        const input = $(`novoValorEixo_${eixoId}`);
        const valor = input?.value.trim();
        if (!valor) { App.toast('warning', 'Informe um valor.'); return; }
        if (eixo.valores.includes(valor)) { App.toast('warning', 'Esse valor já existe nesse eixo.'); return; }
        eixo.valores.push(valor);
        renderEixos();
    };

    $('btnAddEixo')?.addEventListener('click', () => {
        const input = $('novoEixoNome');
        const nome = input?.value.trim();
        if (!nome) { App.toast('warning', 'Informe o nome do eixo (ex.: Tamanho, Cor).'); return; }
        if (eixosProduto.some(e => e.nome.toLowerCase() === nome.toLowerCase())) { App.toast('warning', 'Já existe um eixo com esse nome.'); return; }
        eixosProduto.push({ id: nextEixoId(), nome, valores: [] });
        input.value = '';
        renderEixos();
    });

    // Calcula o produto cartesiano dos valores de todos os eixos e gera/atualiza
    // as variações correspondentes — preserva variações já configuradas (mesmo
    // nome concatenado mantém variacaoId/preços/receita); combinações que
    // existiam antes e não são mais geradas NÃO são removidas automaticamente
    // (evita perder histórico de venda).
    $('btnGerarVariacoes')?.addEventListener('click', () => {
        const eixosComValores = eixosProduto.filter(e => e.valores.length);
        if (!eixosComValores.length) { App.toast('warning', 'Adicione ao menos um eixo com valores.'); return; }

        let combinacoes = [{}];
        for (const eixo of eixosComValores) {
            const novas = [];
            for (const combo of combinacoes) {
                for (const valor of eixo.valores) {
                    novas.push({ ...combo, [eixo.nome]: valor });
                }
            }
            combinacoes = novas;
        }

        let criadas = 0;
        combinacoes.forEach(combo => {
            const nomeConcatenado = Object.values(combo).join(' / ');
            const existente = variacoesMultiplas.find(v => v.variacao.trim() === nomeConcatenado);
            if (existente) { existente.eixos = combo; return; }
            const nova = novaVariacaoMultipla();
            nova.variacao = nomeConcatenado;
            nova.eixos = combo;
            variacoesMultiplas.push(nova);
            criadas++;
        });

        renderVariacaoSelectOptions();
        renderVariacoesResumo();
        App.toast('success', `${combinacoes.length} combinação${combinacoes.length !== 1 ? 'ões' : ''} geradas (${criadas} nova${criadas !== 1 ? 's' : ''}).`);
    });

    // =========================================================
    // TEMAS E SUBTEMAS (produtos SOB_ENCOMENDA) — editados de DENTRO do
    // modal de cada variação (a pedido do usuário), mas pertencem ao
    // PRODUTO inteiro: abrir o modal de qualquer tamanho mostra e edita a
    // MESMA lista — não há nada pra "copiar" entre variações porque já é
    // tudo compartilhado. Sem limite de quantidade de temas nem de
    // subtemas; cada subtema exige seu próprio PDF, assim como o tema.
    // Diferente de eixos/variações (estado local até o submit final), cada
    // ação aqui já chama o endpoint correspondente imediatamente — temas
    // são sub-recursos próprios, só existem depois que o produto tem `id`.
    // =========================================================
    let temasProduto = []; // [{id, nome, limite_subtemas, subtemas:[{id,nome}]}]

    async function carregarTemas() {
        if (!editandoId) { temasProduto = []; return; }
        try {
            temasProduto = await App.api(`/produtos/${editandoId}/temas`);
        } catch (err) {
            temasProduto = [];
            App.toast('error', 'Erro ao carregar temas: ' + err.message);
        }
    }

    function temasSecaoHtml() {
        if (tipoAtivo !== 'SOB_ENCOMENDA') return '';
        if (!editandoId) {
            return `
              <div class="prec-bloco" style="margin-top:10px">
                <div class="prec-bloco-header"><span><i class="bx bx-images"></i> Temas e subtemas (todo o produto)</span></div>
                <p class="text-muted" style="padding:10px 0">Salve o produto pelo menos uma vez para poder cadastrar temas.</p>
              </div>`;
        }
        return `
          <div class="prec-bloco" style="margin-top:10px">
            <div class="prec-bloco-header"><span><i class="bx bx-images"></i> Temas e subtemas <small class="text-muted">(valem para todos os tamanhos deste produto)</small></span></div>
            <div class="eixos-lista">
              ${temasProduto.map(t => `
                <div class="eixo-card" data-tema="${t.id}">
                    <div class="eixo-card-header">
                        <strong>${esc(t.nome)}</strong>${t.limite_subtemas ? ` <small class="text-muted">(limite: ${t.limite_subtemas} subtema${t.limite_subtemas !== 1 ? 's' : ''})</small>` : ''}
                        <div style="display:flex;gap:6px;margin-left:auto">
                            <button type="button" class="btn btn-small" onclick="window._temaPreview(${t.id})"><i class="bx bx-show"></i> Ver prévia</button>
                            <button type="button" class="icon-btn" title="Remover tema" onclick="window._temaRemover(${t.id})"><i class="bx bx-trash"></i></button>
                        </div>
                    </div>
                    ${t.limite_subtemas ? `
                        <div class="eixo-valores" style="flex-direction:column;align-items:stretch">
                            ${t.subtemas.map(s => `
                                <span class="eixo-valor-chip" style="justify-content:space-between">
                                    ${esc(s.nome)}
                                    <span>
                                        <button type="button" title="Ver prévia" onclick="window._subtemaPreview(${s.id})"><i class="bx bx-show"></i></button>
                                        <button type="button" title="Remover" onclick="window._subtemaRemover(${t.id}, ${s.id})"><i class="bx bx-x"></i></button>
                                    </span>
                                </span>`).join('')}
                            <span class="eixo-valor-add">
                                <input type="text" id="novoSubtemaNome_${t.id}" placeholder="Nome do subtema">
                                <input type="file" id="novoSubtemaPdf_${t.id}" accept="application/pdf,image/jpeg,image/png" style="max-width:200px">
                                <button type="button" class="btn btn-small" onclick="window._subtemaAdicionar(${t.id})"><i class="bx bx-plus"></i></button>
                            </span>
                        </div>` : ''}
                </div>
              `).join('')}
            </div>
            <div class="eixos-add-row" style="margin-top:8px">
                <input type="text" id="novoTemaNome" placeholder="Nome do tema (ex.: MARVEL)">
                <input type="number" id="novoTemaLimiteSubtemas" placeholder="Limite de subtemas (opcional)" min="1" style="max-width:180px">
                <input type="file" id="novoTemaPdf" accept="application/pdf,image/jpeg,image/png" style="max-width:220px">
                <button type="button" class="btn btn-primary" onclick="window._temaAdicionar()"><i class="bx bx-plus"></i> Adicionar tema</button>
            </div>
          </div>`;
    }

    window._temaAdicionar = async () => {
        if (!editandoId) return App.toast('warning', 'Salve o produto antes de cadastrar temas.');
        const nome = $('novoTemaNome')?.value.trim();
        const limite = $('novoTemaLimiteSubtemas')?.value;
        const arquivo = $('novoTemaPdf')?.files?.[0];
        if (!nome) return App.toast('warning', 'Informe o nome do tema.');
        if (!arquivo) return App.toast('warning', 'Selecione o arquivo do tema (PDF, JPG ou PNG).');
        const fd = new FormData();
        fd.append('nome', nome);
        if (limite) fd.append('limite_subtemas', limite);
        fd.append('arquivo', arquivo);
        try {
            const novo = await App.api(`/produtos/${editandoId}/temas`, { method: 'POST', body: fd });
            temasProduto.push(novo);
            renderVariacaoModalBody();
        } catch (err) { App.toast('error', err.message); }
    };

    window._temaRemover = async (id) => {
        const ok = await App.confirmDialog({ title: 'Remover tema?', text: 'O arquivo e os subtemas associados também serão removidos.', confirmText: 'Remover' });
        if (!ok.isConfirmed) return;
        try {
            await App.api(`/produto-temas/${id}`, { method: 'DELETE' });
            temasProduto = temasProduto.filter(t => t.id !== id);
            renderVariacaoModalBody();
        } catch (err) { App.toast('error', err.message); }
    };

    window._subtemaRemover = async (temaId, subtemaId) => {
        try {
            await App.api(`/produto-subtemas/${subtemaId}`, { method: 'DELETE' });
            const tema = temasProduto.find(t => t.id === temaId);
            if (tema) tema.subtemas = tema.subtemas.filter(s => s.id !== subtemaId);
            renderVariacaoModalBody();
        } catch (err) { App.toast('error', err.message); }
    };

    window._subtemaAdicionar = async (temaId) => {
        const nome = $(`novoSubtemaNome_${temaId}`)?.value.trim();
        const arquivo = $(`novoSubtemaPdf_${temaId}`)?.files?.[0];
        if (!nome) return App.toast('warning', 'Informe o nome do subtema.');
        if (!arquivo) return App.toast('warning', 'Selecione o arquivo do subtema (PDF, JPG ou PNG).');
        const fd = new FormData();
        fd.append('nome', nome);
        fd.append('arquivo', arquivo);
        try {
            const novo = await App.api(`/produto-temas/${temaId}/subtemas`, { method: 'POST', body: fd });
            const tema = temasProduto.find(t => t.id === temaId);
            if (tema) tema.subtemas.push(novo);
            renderVariacaoModalBody();
        } catch (err) { App.toast('error', err.message); }
    };

    function abrirPreviewTema(titulo, endpoint) {
        $('modalPreviewTemaTitulo').textContent = titulo;
        $('modalPreviewTema')?.classList.remove('hidden');
        $('modalPreviewTema')?.setAttribute('aria-hidden', 'false');
        PdfProtegido.renderizar($('modalPreviewTemaBody'), endpoint, { autenticado: true })
            .then(desbloquear => { _previewTemaDesbloquear = desbloquear; });
    }
    let _previewTemaDesbloquear = null;
    window._temaPreview = (id) => abrirPreviewTema('Prévia do tema', `/api/produto-temas/${id}/preview`);
    window._subtemaPreview = (id) => abrirPreviewTema('Prévia do subtema', `/api/produto-subtemas/${id}/preview`);

    $('btnFecharModalPreviewTema')?.addEventListener('click', () => {
        $('modalPreviewTema')?.classList.add('hidden');
        $('modalPreviewTema')?.setAttribute('aria-hidden', 'true');
        $('modalPreviewTemaBody').innerHTML = '';
        if (_previewTemaDesbloquear) { _previewTemaDesbloquear(); _previewTemaDesbloquear = null; }
    });

    // =========================================================
    // PASSO 2 — VARIAÇÕES (dropdown "+ Adicionar variação" + modal + resumo em chips)
    // =========================================================
    function novaVariacaoMultipla() {
        return { id: nextVarMultId(), variacaoId: null, variacao: '', sku: '', preco_venda: 0, precosQtd: [], quantidadeProduzida: 1, precItens: { materiais: [], maquinas: [], mao_obra: [] }, eixos: null };
    }

    function renderVariacaoSelectOptions() {
        const sel = $('variacaoSelect');
        if (!sel) return;
        sel.innerHTML = '<option value="">Selecione para editar...</option>' +
            variacoesMultiplas.map(v => `<option value="${v.id}">${esc(v.variacao || '(sem nome)')}</option>`).join('');
        sel.value = '';
    }

    function renderVariacoesResumo() {
        const el = $('variacoesResumo');
        if (!el) return;
        if (!variacoesMultiplas.length) { el.innerHTML = ''; return; }
        el.innerHTML = variacoesMultiplas.map(v => {
            const calc = calcularCustoVariacao(v);
            return `<span class="variacao-chip" data-id="${v.id}">
                ${esc(v.variacao || '(sem nome)')}
                <small>${money(calc.pAdjUnit)}</small>
                <button type="button" class="icon-btn" data-remove="${v.id}" title="Remover variação"><i class="bx bx-x"></i></button>
            </span>`;
        }).join('');
        el.querySelectorAll('.variacao-chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                if (e.target.closest('[data-remove]')) return;
                abrirModalVariacao(Number(chip.dataset.id));
            });
        });
        el.querySelectorAll('[data-remove]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = Number(btn.dataset.remove);
                const r = await App.confirmDialog({ title: 'Remover esta variação?', text: 'Os dados de precificação dela serão perdidos.' });
                if (!r.isConfirmed) return;
                variacoesMultiplas = variacoesMultiplas.filter(v => v.id !== id);
                renderVariacaoSelectOptions();
                renderVariacoesResumo();
            });
        });
    }

    $('variacaoSelect')?.addEventListener('change', () => {
        const sel = $('variacaoSelect');
        const val = sel?.value;
        if (!val) return; // "Selecione para editar..." — nada a abrir
        abrirModalVariacao(Number(val));
    });

    // Botão "+" dedicado: sempre abre o modal de nova variação, em qualquer estado do select.
    $('btnAddVariacao')?.addEventListener('click', () => abrirModalVariacao(null));

    function abrirModalVariacao(id) {
        if (id) {
            variacaoModalId = id;
            _variacaoModalEraNova = false;
        } else {
            const nova = novaVariacaoMultipla();
            variacoesMultiplas.push(nova);
            variacaoModalId = nova.id;
            _variacaoModalEraNova = true;
        }
        if ($('modalVariacaoTitulo')) $('modalVariacaoTitulo').textContent = _variacaoModalEraNova ? 'Nova variação' : 'Editar variação';
        if ($('btnRemoverVariacaoModal')) $('btnRemoverVariacaoModal').style.display = _variacaoModalEraNova ? 'none' : '';
        carregarMaquinas();
        carregarInsumos();
        renderVariacaoModalBody();
        $('modalVariacao')?.classList.remove('hidden');
        $('modalVariacao')?.setAttribute('aria-hidden', 'false');
    }

    function fecharModalVariacao({ cancelado = false } = {}) {
        if (cancelado && _variacaoModalEraNova) {
            variacoesMultiplas = variacoesMultiplas.filter(v => v.id !== variacaoModalId);
        }
        variacaoModalId = null;
        _variacaoModalEraNova = false;
        $('modalVariacao')?.classList.add('hidden');
        $('modalVariacao')?.setAttribute('aria-hidden', 'true');
        renderVariacaoSelectOptions();
        renderVariacoesResumo();
    }

    $('btnFecharModalVariacao')?.addEventListener('click', () => fecharModalVariacao({ cancelado: true }));
    $('btnCancelarVariacaoModal')?.addEventListener('click', () => fecharModalVariacao({ cancelado: true }));
    $('btnSalvarVariacaoModal')?.addEventListener('click', () => {
        const v = variacoesMultiplas.find(x => x.id === variacaoModalId);
        if (!v || !v.variacao.trim()) { App.toast('warning', 'Informe o nome da variação.'); return; }
        fecharModalVariacao({ cancelado: false });
    });
    $('btnRemoverVariacaoModal')?.addEventListener('click', async () => {
        const r = await App.confirmDialog({ title: 'Remover esta variação?', text: 'Os dados de precificação dela serão perdidos.' });
        if (!r.isConfirmed) return;
        variacoesMultiplas = variacoesMultiplas.filter(v => v.id !== variacaoModalId);
        fecharModalVariacao({ cancelado: false });
    });

    // =========================================================
    // PASSO 3 — PRECIFICAÇÃO UNIVERSAL (custos/margem compartilhados)
    // =========================================================
    function templateUniversal() {
        return `
        <div class="form-grid mt-2">
          <div class="form-group"><label>Unidade</label>
            <select id="unidade_precificacao" name="unidade_precificacao">
              <option>UNIDADE</option><option>KIT</option><option>CARTELA</option><option>PAR</option><option>LOTE</option>
            </select>
          </div>
          <div class="form-group"><label>Status</label>
            <select id="status" name="status">
              <option value="ATIVO">ATIVO</option><option value="INATIVO">INATIVO</option>
              <option value="SEM ESTOQUE">SEM ESTOQUE</option><option value="EM TESTE">EM TESTE</option>
            </select>
          </div>
        </div>

        ${tipoAtivo === 'SOB_ENCOMENDA' ? `
        <div class="form-grid mt-3">
          <div class="form-group"><label>Prazo de produção (dias)</label>
            <input id="lead_time_dias" name="lead_time_dias" type="number" min="1" value="7">
            <small class="text-muted">Tempo médio para fabricar após pedido.</small>
          </div>
          <div class="form-group"><label>Quantidade mínima de pedido</label>
            <input id="qtd_minima" name="qtd_minima" type="number" min="1" value="1">
          </div>
        </div>` : ''}

        ${tipoAtivo === 'SERVICO' ? `
        <div class="form-grid mt-3">
          <div class="form-group"><label>Tipo de cobrança</label>
            <select id="tipo_cobranca" name="tipo_cobranca"><option value="FIXO">Preço fixo</option><option value="HORA">Por hora</option></select>
          </div>
          <div class="form-group"><label>Horas estimadas</label>
            <input id="horas_estimadas" name="horas_estimadas" type="number" step="0.5" min="0" value="1">
          </div>
          <div class="form-group"><label>Valor/hora (R$)</label>
            <input id="valor_hora" name="valor_hora" type="number" step="0.01" min="0" value="0">
            <small class="text-muted">Se por hora: preço = horas × valor/hora.</small>
          </div>
        </div>` : ''}

        ${tipoAtivo === 'PROJETO_DIGITAL' ? `
        <div class="form-grid mt-3">
          <div class="form-group"><label>Tipo de projeto</label>
            <select id="subtipo_projeto" name="subtipo_projeto">
              <option>Site institucional</option><option>E-commerce</option><option>Aplicativo mobile</option>
              <option>Sistema web</option><option>Landing page</option><option>Identidade visual</option><option>Outro</option>
            </select>
          </div>
          <div class="form-group"><label>Prazo estimado (dias)</label>
            <input id="lead_time_dias" name="lead_time_dias" type="number" min="1" value="30">
          </div>
          <div class="form-group"><label>Tipo de cobrança</label>
            <select id="tipo_cobranca" name="tipo_cobranca">
              <option value="FIXO">Preço fixo</option><option value="HORA">Por hora</option><option value="ETAPA">Por etapa</option>
            </select>
          </div>
          <div class="form-group"><label>Horas estimadas</label>
            <input id="horas_estimadas" name="horas_estimadas" type="number" step="1" min="0" value="0">
          </div>
          <div class="form-group"><label>Valor/hora (R$)</label>
            <input id="valor_hora" name="valor_hora" type="number" step="0.01" min="0" value="0">
          </div>
        </div>` : ''}

        ${tipoAtivo === 'REVENDA' ? `
        <div class="form-grid mt-3">
          <div class="form-group"><label>Fornecedor</label>
            <input id="fornecedor" name="fornecedor" placeholder="Nome do fornecedor">
          </div>
          <div class="form-group"><label>Código do fornecedor</label>
            <input id="codigo_fornecedor" name="codigo_fornecedor" placeholder="Referência do fornecedor">
          </div>
          <div class="form-group"><label>Preço de compra (R$)</label>
            <input id="preco_compra" name="preco_compra" type="number" step="0.01" min="0" value="0">
          </div>
          <div class="form-group"><label>Margem de lucro (%)</label>
            <input id="margem_revenda" name="margem_revenda" type="number" step="0.01" min="0" value="30">
            <small class="text-muted">Preço de venda = compra × (1 + margem/100)</small>
          </div>
        </div>` : ''}

        ${tipoAtivo === 'PACOTE' ? `
        <div class="form-group mt-3">
          <label>Itens do pacote</label>
          <textarea id="itens_pacote" name="itens_pacote" placeholder="Descreva os itens incluídos neste pacote/combo, um por linha.&#10;Ex.:&#10;2x Saboneteira personalizada&#10;1x Suporte de escova de dentes"></textarea>
        </div>
        <div class="form-grid mt-2">
          <div class="form-group"><label>Desconto do pacote (%)</label>
            <input id="desconto_pacote" name="desconto_pacote" type="number" step="0.01" min="0" value="0">
            <small class="text-muted">Desconto sobre a soma dos itens individuais.</small>
          </div>
        </div>` : ''}

        <!-- PRECIFICAÇÃO UNIVERSAL -->
        <div class="prec-universal">
          <div class="prec-universal-header">
            <span><i class="bx bx-calculator"></i> Precificação detalhada</span>
            <small class="text-muted">Materiais, máquinas e mão de obra são definidos por variação (passo 2 → "+ Adicionar variação"). Aqui ficam só os custos e a margem compartilhados entre as variações.</small>
          </div>

          <!-- Outros custos -->
          <div class="prec-bloco">
            <div class="prec-bloco-header"><span><i class="bx bx-detail"></i> Outros custos</span></div>
            <div class="form-grid">
              <div class="form-group"><label>Embalagem (R$)</label>
                <input id="custo_embalagem" name="custo_embalagem" type="number" step="0.01" min="0" value="0">
              </div>
              <div class="form-group"><label>Entrega / transporte (R$)</label>
                <input id="custo_entrega" name="custo_entrega" type="number" step="0.01" min="0" value="0">
              </div>
              <div class="form-group"><label>Taxas extras (R$)</label>
                <input id="custo_taxas" name="custo_taxas" type="number" step="0.01" min="0" value="0">
              </div>
              <div class="form-group"><label>Outros / extras (R$)</label>
                <input id="custo_extra" name="custo_extra" type="number" step="0.01" min="0" value="0">
              </div>
              <div class="form-group">
                <label>Perdas / refugo</label>
                <div class="prec-input-combo">
                  <input id="custo_perdas" name="custo_perdas" type="number" step="0.01" min="0" value="0">
                  <select id="perdas_tipo" name="perdas_tipo">
                    <option value="VALOR">R$</option>
                    <option value="PERCENTUAL">%</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <!-- Margem e canal -->
          <div class="prec-bloco">
            <div class="prec-bloco-header"><span><i class="bx bx-trending-up"></i> Margem e canal</span></div>
            <div class="form-grid">
              <div class="form-group"><label>Canal de venda</label>
                <select id="canal_venda" name="canal_venda">
                  <option>Venda direta</option><option>Consignação</option><option>Revendedor</option>
                  <option>Atacado</option><option>Shopee</option><option>Mercado Livre</option>
                </select>
              </div>
              <div class="form-group"><label>Taxa canal (%)</label>
                <input id="taxa_canal_percentual" name="taxa_canal_percentual" type="number" step="0.01" min="0" value="0">
              </div>
              <div class="form-group"><label>Taxa fixa canal (R$)</label>
                <input id="taxa_canal_fixa" name="taxa_canal_fixa" type="number" step="0.01" min="0" value="0">
              </div>
              <div class="form-group">
                <label>Markup (%)</label>
                <input id="margem_percentual" name="margem_percentual" type="number" step="0.01" min="0" value="40">
                <small class="text-muted">100% = dobra o custo unitário</small>
              </div>
            </div>
          </div>
        </div>`;
    }

    function renderStep3() {
        const content = $('step3Content');
        if (!content) return;
        renderBadge('badge3');
        content.innerHTML = templateUniversal();
        if ($('precificado')) $('precificado').value = 'true';
        bindStep3Events();
        preencherStep3Edicao();
    }

    // Recalcula o conteúdo do modal de variação se ele estiver aberto
    // (chamado quando custos/margem compartilhados mudam).
    function recalcularModalAberto() {
        if (variacaoModalId) renderVariacaoModalBody();
    }

    function badgePendenteInsumo(insumoId) {
        if (!insumoId) return '';
        const ins = insumos.find(i => Number(i.id) === Number(insumoId));
        if (!ins || ins.status !== 'PRE_CADASTRO') return '';
        return ' <span class="badge badge-yellow" style="font-size:10px">Pendente de compra</span>';
    }

    // Calcula o custo desta variação a partir dos SEUS PRÓPRIOS materiais/
    // máquinas/mão de obra, somado aos custos compartilhados (embalagem,
    // entrega, taxas, perdas, margem, canal) configurados no bloco global.
    function calcularCustoVariacao(v) {
        const qtd = Math.max(1, parseInt(v.quantidadeProduzida, 10) || 1);
        const totalMat = v.precItens.materiais.reduce((s, m) => s + m.quantidade * m.custo_unitario, 0);
        const totalMaq = v.precItens.maquinas.reduce((s, m) => {
            const h = m.unidade_tempo === 'h' ? m.tempo : m.tempo / 60;
            return s + h * m.custo_hora;
        }, 0);
        const totalMo = v.precItens.mao_obra.reduce((s, m) => {
            const h = m.unidade_tempo === 'h' ? m.tempo : m.tempo / 60;
            return s + h * m.valor_hora;
        }, 0);
        const totalOut = moedaNum('custo_embalagem') + moedaNum('custo_entrega') + moedaNum('custo_taxas') + moedaNum('custo_extra');
        const perdas = moedaNum('custo_perdas');
        const perdasTipo = $('perdas_tipo')?.value || 'VALOR';
        const subTotal = totalMat + totalMaq + totalMo + totalOut;
        const totalPerd = perdasTipo === 'PERCENTUAL' ? subTotal * (perdas / 100) : perdas;
        const custoTotal = subTotal + totalPerd;
        const custoUnit = custoTotal / qtd;
        const marg = moedaNum('margem_percentual');
        const taxaP = moedaNum('taxa_canal_percentual');
        const taxaF = moedaNum('taxa_canal_fixa');
        const pSugUnit = custoUnit * (1 + marg / 100);
        const divisor = (1 - taxaP / 100) || 1;
        const pAdjUnit = (pSugUnit + taxaF / qtd) / divisor;
        return { totalMat, totalMaq, totalMo, totalOut, totalPerd, custoTotal, custoUnit, pAdjUnit, qtd };
    }

    function renderVarItemList(itens, fmtFn) {
        if (!itens.length) return '';
        return itens.map(fmtFn).join('');
    }

    function opcoesInsumosHtml() {
        return '<option value="">Personalizado...</option>' +
            insumos.filter(i => String(i.status || 'ATIVO') !== 'INATIVO')
                .map(i => `<option value="${i.id}">${i.status === 'PRE_CADASTRO' ? '⚠ ' : ''}${esc(i.nome)} • ${money(i.custo_unitario)}/${esc(i.unidade)}${i.status === 'PRE_CADASTRO' ? ' (pré-cadastro)' : ''}</option>`).join('');
    }
    function opcoesMaquinasHtml() {
        return '<option value="">Selecione...</option>' +
            maquinas.filter(m => String(m.status || 'ATIVA') !== 'INATIVA')
                .map(m => `<option value="${m.id}">${esc(m.nome)}${m.modelo ? ' - ' + esc(m.modelo) : ''} • ${money(m.custo_total_hora)}/h</option>`).join('');
    }

    // Renderiza o conteúdo do modal de variação para a variação atualmente aberta (variacaoModalId)
    function renderVariacaoModalBody() {
        const body = $('modalVariacaoBody');
        if (!body) return;
        const v = variacoesMultiplas.find(x => x.id === variacaoModalId);
        if (!v) { body.innerHTML = ''; return; }
        const calc = calcularCustoVariacao(v);
        body.innerHTML = `
          <div class="prec-add-row">
            <div class="form-group"><label>Nome do tamanho/variação *</label>
              <input value="${esc(v.variacao)}" placeholder="Ex: 10x15" oninput="window._varMultSetNome(${v.id}, this.value)">
            </div>
            <div class="form-group"><label>SKU</label>
              <input value="${esc(v.sku || '')}" oninput="window._varMultSetSku(${v.id}, this.value)">
            </div>
            <div class="form-group"><label>Qtd. produzida (base do custo)</label>
              <input type="number" min="1" value="${v.quantidadeProduzida || 1}" oninput="window._varMultSetQtdProduzida(${v.id}, this.value)">
            </div>
          </div>

          <div class="prec-bloco" style="margin-top:10px">
            <div class="prec-bloco-header"><span><i class="bx bx-package"></i> Materiais/insumos deste tamanho</span></div>
            <div class="prec-lista">${renderVarItemList(v.precItens.materiais, m => {
                const total = m.quantidade * m.custo_unitario;
                return `<div class="prec-item">
                  <div class="prec-item-info">
                    <span class="prec-item-nome">${esc(m.nome)}${badgePendenteInsumo(m.insumo_id)}</span>
                    <span class="prec-item-detalhe">${m.quantidade} ${esc(m.unidade)} × ${money(m.custo_unitario)}/un</span>
                  </div>
                  <span class="prec-item-total">${money(total)}</span>
                  <button type="button" class="btn btn-small btn-danger" onclick="window._varMatRemover(${v.id},${m.id})"><i class="bx bx-trash"></i></button>
                </div>`;
            })}</div>
            <div class="prec-add-row" style="margin-top:6px">
              <div class="form-group"><label>Insumo</label><select id="selMatIns_${v.id}">${opcoesInsumosHtml()}</select></div>
              <div class="form-group"><label>Nome (se personalizado)</label><input id="selMatNome_${v.id}" placeholder="Ex: Filamento PLA"></div>
              <div class="form-group"><label>Qtd.</label><input id="selMatQtd_${v.id}" type="number" step="0.001" min="0" value="0"></div>
              <div class="form-group"><label>Unidade</label>
                <select id="selMatUn_${v.id}">
                  <option value="un">un</option><option value="g">g</option><option value="kg">kg</option>
                  <option value="ml">ml</option><option value="L">L</option><option value="folha">folha</option>
                  <option value="m²">m²</option><option value="m">m</option>
                </select>
              </div>
              <div class="form-group"><label>Custo/un (R$)</label><input id="selMatCusto_${v.id}" type="number" step="0.0001" min="0" value="0"></div>
              <div class="form-group prec-add-actions"><label>&nbsp;</label>
                <button type="button" class="btn btn-primary btn-small" onclick="window._varMatAdicionar(${v.id})"><i class="bx bx-plus"></i></button>
              </div>
            </div>
          </div>

          <div class="prec-bloco" style="margin-top:10px">
            <div class="prec-bloco-header"><span><i class="bx bx-cog"></i> Máquinas/recursos deste tamanho</span></div>
            <div class="prec-lista">${renderVarItemList(v.precItens.maquinas, m => {
                const h = m.unidade_tempo === 'h' ? m.tempo : m.tempo / 60;
                const total = h * m.custo_hora;
                return `<div class="prec-item">
                  <div class="prec-item-info">
                    <span class="prec-item-nome">${esc(m.nome)}</span>
                    <span class="prec-item-detalhe">${m.tempo} ${m.unidade_tempo === 'h' ? 'h' : 'min'} × ${money(m.custo_hora)}/h</span>
                  </div>
                  <span class="prec-item-total">${money(total)}</span>
                  <button type="button" class="btn btn-small btn-danger" onclick="window._varMaqRemover(${v.id},${m.id})"><i class="bx bx-trash"></i></button>
                </div>`;
            })}</div>
            <div class="prec-add-row" style="margin-top:6px">
              <div class="form-group"><label>Máquina</label><select id="selMaqId_${v.id}">${opcoesMaquinasHtml()}</select></div>
              <div class="form-group"><label>Tempo</label><input id="selMaqTempo_${v.id}" type="number" step="0.01" min="0" value="0"></div>
              <div class="form-group"><label>Unidade</label>
                <select id="selMaqUn_${v.id}"><option value="h">hora</option><option value="min">minuto</option></select>
              </div>
              <div class="form-group"><label>Custo/h (R$)</label><input id="selMaqCusto_${v.id}" type="number" step="0.0001" min="0" value="0" placeholder="automático"></div>
              <div class="form-group prec-add-actions"><label>&nbsp;</label>
                <button type="button" class="btn btn-primary btn-small" onclick="window._varMaqAdicionar(${v.id})"><i class="bx bx-plus"></i></button>
              </div>
            </div>
          </div>

          <div class="prec-bloco" style="margin-top:10px">
            <div class="prec-bloco-header"><span><i class="bx bx-user"></i> Mão de obra deste tamanho</span></div>
            <div class="prec-lista">${renderVarItemList(v.precItens.mao_obra, m => {
                const h = m.unidade_tempo === 'h' ? m.tempo : m.tempo / 60;
                const total = h * m.valor_hora;
                return `<div class="prec-item">
                  <div class="prec-item-info">
                    <span class="prec-item-nome">${esc(m.descricao)}</span>
                    <span class="prec-item-detalhe">${m.tempo} ${m.unidade_tempo === 'h' ? 'h' : 'min'} × ${money(m.valor_hora)}/h</span>
                  </div>
                  <span class="prec-item-total">${money(total)}</span>
                  <button type="button" class="btn btn-small btn-danger" onclick="window._varMoRemover(${v.id},${m.id})"><i class="bx bx-trash"></i></button>
                </div>`;
            })}</div>
            <div class="prec-add-row" style="margin-top:6px">
              <div class="form-group"><label>Descrição</label><input id="selMoDesc_${v.id}" placeholder="Ex: Acabamento"></div>
              <div class="form-group"><label>Tempo</label><input id="selMoTempo_${v.id}" type="number" step="0.01" min="0" value="0"></div>
              <div class="form-group"><label>Unidade</label>
                <select id="selMoUn_${v.id}"><option value="h">hora</option><option value="min">minuto</option></select>
              </div>
              <div class="form-group"><label>Valor/h (R$)</label><input id="selMoValor_${v.id}" type="number" step="0.01" min="0" value="0"></div>
              <div class="form-group prec-add-actions"><label>&nbsp;</label>
                <button type="button" class="btn btn-primary btn-small" onclick="window._varMoAdicionar(${v.id})"><i class="bx bx-plus"></i></button>
              </div>
            </div>
          </div>

          <div class="prec-r-row prec-r-unit" style="margin-top:10px">
            <small>Custo unit. desta variação (c/ custos e margem compartilhados)</small><strong>${money(calc.custoUnit)}</strong>
          </div>
          <div class="prec-r-row prec-r-sug" style="margin-top:4px">
            <small>Preço sugerido</small><strong>${money(calc.pAdjUnit)}</strong>
          </div>

          <label style="font-size:12px;font-weight:700;color:var(--text-2);display:block;margin:14px 0 6px">
            <i class="bx bx-spreadsheet"></i> Tabela de preço por quantidade
          </label>
          <div class="prec-lista">
            ${v.precosQtd.map(f => {
                // Custo desta faixa = custo unitário base × quantidade da faixa
                // (escala com a quantidade — 3un custa mais que 2un, e assim por diante).
                const custoFaixa = calc.custoUnit * f.quantidade;
                const precoTotalFaixa = f.preco * f.quantidade;
                const margem = calc.custoUnit > 0 ? ((f.preco - calc.custoUnit) / calc.custoUnit * 100) : null;
                return `<div class="prec-item">
                  <div class="prec-item-info">
                    <span class="prec-item-nome">${f.quantidade} un.</span>
                    <span class="prec-item-detalhe">
                      <input type="number" step="0.01" min="0" value="${precoTotalFaixa.toFixed(2)}" style="width:90px;display:inline-block"
                             oninput="window._faixaSetPreco(${v.id},${f.id}, this.value)"> total
                      ${calc.custoUnit > 0 ? ` (${money(f.preco)}/un) · custo ${money(custoFaixa)} (${f.quantidade}×${money(calc.custoUnit)}) · margem ${margem.toFixed(0)}%` : ''}
                    </span>
                  </div>
                  <button type="button" class="btn btn-small btn-danger" onclick="window._faixaRemover(${v.id},${f.id})"><i class="bx bx-trash"></i></button>
                </div>`;
            }).join('')}
          </div>
          <div class="prec-add-row" style="margin-top:8px">
            <div class="form-group"><label>Quantidade</label><input type="number" min="1" id="novaFaixaQtd_${v.id}" value="1"></div>
            <div class="form-group"><label>Valor de venda final (R$)</label><input type="number" step="0.01" min="0" id="novaFaixaPreco_${v.id}" value="0" placeholder="Total para essa quantidade"></div>
            <div class="form-group prec-add-actions"><label>&nbsp;</label>
              <button type="button" class="btn btn-primary btn-small" onclick="window._faixaAdicionar(${v.id})"><i class="bx bx-plus"></i></button>
            </div>
          </div>

          ${temasSecaoHtml()}`;
    }

    window._varMultSetNome = (id, val) => { const v = variacoesMultiplas.find(x => x.id === id); if (v) v.variacao = val; };
    window._varMultSetSku  = (id, val) => { const v = variacoesMultiplas.find(x => x.id === id); if (v) v.sku = val; };
    window._varMultSetQtdProduzida = (id, val) => {
        const v = variacoesMultiplas.find(x => x.id === id);
        if (v) { v.quantidadeProduzida = parseInt(val, 10) || 1; renderVariacaoModalBody(); }
    };

    // --- Materiais/máquinas/mão de obra POR VARIAÇÃO ---
    window._varMatAdicionar = (vid) => {
        const v = variacoesMultiplas.find(x => x.id === vid);
        if (!v) return;
        const insumoId = $(`selMatIns_${vid}`)?.value ? parseInt($(`selMatIns_${vid}`).value, 10) : null;
        const insumo = insumoId ? insumos.find(i => i.id === insumoId) : null;
        const nome = insumo ? insumo.nome : ($(`selMatNome_${vid}`)?.value.trim() || '');
        const qtd = parseFloat($(`selMatQtd_${vid}`)?.value || '0') || 0;
        const unidade = insumo ? (insumo.unidade || 'un') : ($(`selMatUn_${vid}`)?.value || 'un');
        const custo = insumo ? Number(insumo.custo_unitario || 0) : (parseFloat($(`selMatCusto_${vid}`)?.value || '0') || 0);
        if (!nome) { App.toast('warning', 'Informe o material ou selecione um insumo.'); return; }
        if (qtd <= 0) { App.toast('warning', 'Informe a quantidade.'); return; }
        v.precItens.materiais.push({ id: nextPrecId(), nome, quantidade: qtd, unidade, custo_unitario: custo, insumo_id: insumoId });
        renderVariacaoModalBody();
    };
    window._varMatRemover = (vid, mid) => {
        const v = variacoesMultiplas.find(x => x.id === vid);
        if (!v) return;
        v.precItens.materiais = v.precItens.materiais.filter(m => m.id !== mid);
        renderVariacaoModalBody();
    };

    window._varMaqAdicionar = (vid) => {
        const v = variacoesMultiplas.find(x => x.id === vid);
        if (!v) return;
        const maqId = $(`selMaqId_${vid}`)?.value;
        const m = maqId ? maquinas.find(x => String(x.id) === maqId) : null;
        if (!maqId) { App.toast('warning', 'Selecione uma máquina.'); return; }
        const tempo = parseFloat($(`selMaqTempo_${vid}`)?.value || '0') || 0;
        if (tempo <= 0) { App.toast('warning', 'Informe o tempo de uso.'); return; }
        const unidade_tempo = $(`selMaqUn_${vid}`)?.value || 'h';
        const custo_hora = parseFloat($(`selMaqCusto_${vid}`)?.value || '0') || (m?.custo_total_hora || 0);
        v.precItens.maquinas.push({ id: nextPrecId(), maquina_id: m?.id || null, nome: m?.nome || 'Máquina', tempo, unidade_tempo, custo_hora });
        renderVariacaoModalBody();
    };
    window._varMaqRemover = (vid, mid) => {
        const v = variacoesMultiplas.find(x => x.id === vid);
        if (!v) return;
        v.precItens.maquinas = v.precItens.maquinas.filter(m => m.id !== mid);
        renderVariacaoModalBody();
    };

    window._varMoAdicionar = (vid) => {
        const v = variacoesMultiplas.find(x => x.id === vid);
        if (!v) return;
        const desc = $(`selMoDesc_${vid}`)?.value.trim();
        const tempo = parseFloat($(`selMoTempo_${vid}`)?.value || '0') || 0;
        const valorH = parseFloat($(`selMoValor_${vid}`)?.value || '0') || 0;
        const unidade_tempo = $(`selMoUn_${vid}`)?.value || 'h';
        if (!desc) { App.toast('warning', 'Informe a descrição da atividade.'); return; }
        if (tempo <= 0) { App.toast('warning', 'Informe o tempo.'); return; }
        v.precItens.mao_obra.push({ id: nextPrecId(), descricao: desc, tempo, unidade_tempo, valor_hora: valorH });
        renderVariacaoModalBody();
    };
    window._varMoRemover = (vid, mid) => {
        const v = variacoesMultiplas.find(x => x.id === vid);
        if (!v) return;
        v.precItens.mao_obra = v.precItens.mao_obra.filter(m => m.id !== mid);
        renderVariacaoModalBody();
    };

    // O campo na tela é o VALOR DE VENDA FINAL daquela faixa (o total que o
    // cliente paga por "quantidade" unidades, igual à tabela oficial — ex.:
    // "3 un = R$5,90"). Internamente guardamos preço POR UNIDADE (f.preco),
    // que é o que o catálogo/carrinho usam — por isso dividimos aqui.
    window._faixaSetPreco = (vid, fid, val) => {
        const v = variacoesMultiplas.find(x => x.id === vid);
        const f = v?.precosQtd.find(x => x.id === fid);
        if (f) f.preco = (parseFloat(val) || 0) / f.quantidade;
    };
    window._faixaRemover = (vid, fid) => {
        const v = variacoesMultiplas.find(x => x.id === vid);
        if (!v) return;
        v.precosQtd = v.precosQtd.filter(x => x.id !== fid);
        renderVariacaoModalBody();
    };
    window._faixaAdicionar = (vid) => {
        const v = variacoesMultiplas.find(x => x.id === vid);
        if (!v) return;
        const qtd = parseInt($(`novaFaixaQtd_${vid}`)?.value || '0', 10) || 0;
        const valorVendaFinal = parseFloat($(`novaFaixaPreco_${vid}`)?.value || '0') || 0;
        if (qtd <= 0) { App.toast('warning', 'Informe uma quantidade válida.'); return; }
        if (v.precosQtd.some(f => f.quantidade === qtd)) { App.toast('warning', 'Já existe uma faixa para essa quantidade.'); return; }
        const preco = valorVendaFinal / qtd; // guarda por unidade
        v.precosQtd.push({ id: nextFaixaId(), quantidade: qtd, preco });
        v.precosQtd.sort((a, b) => a.quantidade - b.quantidade);
        renderVariacaoModalBody();
    };

    // --- Eventos do passo 3 ---

    function bindStep3Events() {
        // Revenda: auto-calcular
        ['preco_compra','margem_revenda'].forEach(id => {
            $(id)?.addEventListener('input', () => {
                const compra  = moedaNum('preco_compra');
                const margem  = moedaNum('margem_revenda');
                if (compra > 0) recalcularModalAberto();
            });
        });

        // Serviço / Projeto: auto-calcular por hora
        ['horas_estimadas','valor_hora'].forEach(id => {
            $(id)?.addEventListener('input', recalcularModalAberto);
        });

        // Campos compartilhados que afetam o custo de cada variação
        ['custo_embalagem','custo_entrega','custo_taxas','custo_extra',
         'custo_perdas','perdas_tipo','margem_percentual',
         'taxa_canal_percentual','taxa_canal_fixa'].forEach(id => {
            $(id)?.addEventListener('input',  recalcularModalAberto);
            $(id)?.addEventListener('change', recalcularModalAberto);
        });
    }

    async function carregarMaquinas() {
        try {
            maquinas = await App.api('/maquinas');
        } catch { maquinas = []; }
    }

    async function carregarInsumos() {
        try {
            insumos = await App.api('/insumos');
        } catch { insumos = []; }
    }

    // =========================================================
    // PASSO 4 — DESTINO E STATUS
    // =========================================================
    function renderStep4() {
        renderBadge('badge2');
        renderDestinos();
        renderStatusGrid();
    }

    function renderDestinos() {
        const grid = $('destinoGrid');
        if (!grid) return;
        const tipo = TIPOS.find(t => t.id === tipoAtivo);
        const permitidos = tipo?.destinos || DESTINOS.map(d => d.id);
        grid.innerHTML = DESTINOS.filter(d => permitidos.includes(d.id)).map(d => `
            <button type="button" class="destino-card${destinoAtivo === d.id ? ' selected' : ''}" data-destino="${d.id}">
                <i class="bx ${d.icon}"></i>
                <strong>${esc(d.label)}</strong>
                <small>${esc(d.desc)}</small>
            </button>`).join('');
        grid.querySelectorAll('.destino-card').forEach(card => {
            card.addEventListener('click', () => {
                destinoAtivo = card.dataset.destino;
                $('destino_final').value = destinoAtivo;
                renderDestinos();
            });
        });
    }

    function renderStatusGrid() {
        document.querySelectorAll('[data-fluxo]').forEach(btn => {
            btn.classList.toggle('ativo', btn.dataset.fluxo === statusFluxo);
            btn.addEventListener('click', () => {
                statusFluxo = btn.dataset.fluxo;
                $('status_fluxo').value = statusFluxo;
                document.querySelectorAll('[data-fluxo]').forEach(b => b.classList.toggle('ativo', b.dataset.fluxo === statusFluxo));
            });
        });
        $('status_fluxo').value = statusFluxo;
    }

    // =========================================================
    // CROP DE IMAGENS (mantido igual ao original)
    // =========================================================
    const modalCrop     = $('modalCropProduto');
    const imagemCrop    = $('imagemCropProduto');
    const cropStatus    = $('cropStatusProduto');
    const inputImagens  = $('imagens');
    const preview       = $('previewImagem');

    function destruirCropper() {
        if (cropperProduto) { cropperProduto.destroy(); cropperProduto = null; }
        if (cropObjectUrl)  { URL.revokeObjectURL(cropObjectUrl); cropObjectUrl = null; }
        arquivoAtualCrop = null;
    }

    function fecharCrop({ limpar = false } = {}) {
        modalCrop.classList.add('hidden');
        destruirCropper();
        if (limpar) {
            inputImagens.value = '';
            // Revoga blobs dos itens novos (não-URL) que ainda não foram confirmados
            galeriaItems.filter(i => !i.isUrl && i.url.startsWith('blob:')).forEach(i => URL.revokeObjectURL(i.url));
            galeriaItems = galeriaItems.filter(i => i.isUrl); // mantém fotos existentes do edit
            filaCrop = [];
            totalFilaCrop = 0;
            renderPreview();
        }
    }

    function _galeriaWrap() { return document.getElementById('galeriaWrap'); }

    function renderPreview(urlsAtuais = null) {
        // Modo edição: carga inicial de URLs existentes
        if (urlsAtuais) {
            // Limpa itens URL anteriores e recarrega
            galeriaItems = galeriaItems.filter(i => !i.isUrl);
            urlsAtuais.forEach(url => galeriaItems.push({ id: nextGalId(), file: null, url, isUrl: true }));
        }

        const wrap = _galeriaWrap();
        if (!galeriaItems.length) {
            if (wrap) wrap.style.display = 'none';
            preview.className = '';
            preview.innerHTML = '';
            return;
        }
        if (wrap) wrap.style.display = 'block';

        preview.className = 'gal-manager';
        preview.innerHTML = galeriaItems.map((item, i) => `
            <div class="gal-item ${i === 0 ? 'is-principal' : ''}">
                <div class="gal-img-wrap">
                    <img src="${item.url}" alt="Foto ${i + 1}">
                    ${i === 0 ? '<span class="gal-badge-principal">★ Principal</span>' : `<span class="gal-badge-num">${i + 1}ª</span>`}
                </div>
                <div class="gal-actions">
                    <button class="gal-btn" title="Mover esquerda" ${i === 0 ? 'disabled style="opacity:.3"' : ''} onclick="window._galEsq(${item.id})"><i class="bx bx-chevron-left"></i></button>
                    <button class="gal-btn star" title="Definir como principal" ${i === 0 ? 'disabled style="opacity:.3"' : ''} onclick="window._galPrincipal(${item.id})"><i class="bx bxs-star"></i></button>
                    <button class="gal-btn" title="Mover direita" ${i === galeriaItems.length - 1 ? 'disabled style="opacity:.3"' : ''} onclick="window._galDir(${item.id})"><i class="bx bx-chevron-right"></i></button>
                    <button class="gal-btn danger" title="Remover" onclick="window._galRem(${item.id})"><i class="bx bx-trash"></i></button>
                </div>
            </div>
        `).join('');
    }

    window._galEsq = function(id) {
        const idx = galeriaItems.findIndex(i => i.id === id);
        if (idx <= 0) return;
        [galeriaItems[idx - 1], galeriaItems[idx]] = [galeriaItems[idx], galeriaItems[idx - 1]];
        renderPreview();
    };
    window._galDir = function(id) {
        const idx = galeriaItems.findIndex(i => i.id === id);
        if (idx < 0 || idx >= galeriaItems.length - 1) return;
        [galeriaItems[idx], galeriaItems[idx + 1]] = [galeriaItems[idx + 1], galeriaItems[idx]];
        renderPreview();
    };
    window._galPrincipal = function(id) {
        const idx = galeriaItems.findIndex(i => i.id === id);
        if (idx <= 0) return;
        const [item] = galeriaItems.splice(idx, 1);
        galeriaItems.unshift(item);
        renderPreview();
    };
    window._galRem = function(id) {
        const item = galeriaItems.find(i => i.id === id);
        if (item && !item.isUrl && item.url.startsWith('blob:')) URL.revokeObjectURL(item.url);
        galeriaItems = galeriaItems.filter(i => i.id !== id);
        renderPreview();
    };

    function abrirCrop(file) {
        destruirCropper(); // deve vir antes de criar o novo cropObjectUrl
        arquivoAtualCrop = file;
        if (cropObjectUrl) URL.revokeObjectURL(cropObjectUrl);
        cropObjectUrl = URL.createObjectURL(file);

        const idx = totalFilaCrop - filaCrop.length;
        cropStatus.textContent = `Foto ${idx + 1} de ${totalFilaCrop}`;
        modalCrop.classList.remove('hidden');

        imagemCrop.onload = function () {
            this.onload = null;
            if (typeof Cropper === 'undefined') {
                App.toast('error', 'Biblioteca de recorte não carregada. Verifique sua conexão e recarregue a página.');
                fecharCrop({ limpar: true });
                return;
            }
            cropperProduto = new Cropper(imagemCrop, {
                aspectRatio: 1,
                viewMode: 1,
                autoCropArea: 0.85,
                movable: true,
                zoomable: true,
                rotatable: true,
            });
        };
        imagemCrop.src = cropObjectUrl;
    }

    function processarFilaCrop() {
        if (!filaCrop.length) { renderPreview(); return; }
        abrirCrop(filaCrop[0]);
    }

    inputImagens?.addEventListener('change', () => {
        const files = Array.from(inputImagens.files || []).slice(0, 10);
        // Novos arquivos substituem toda a galeria (incluindo fotos existentes do edit)
        galeriaItems.filter(i => !i.isUrl && i.url.startsWith('blob:')).forEach(i => URL.revokeObjectURL(i.url));
        galeriaItems = [];
        filaCrop = [...files];
        totalFilaCrop = files.length;
        processarFilaCrop();
    });

    $('btnAplicarCropProduto')?.addEventListener('click', () => {
        if (!cropperProduto) return;
        cropperProduto.getCroppedCanvas({ width: 1080, height: 1080 }).toBlob(blob => {
            if (!blob) return;
            const nome = arquivoAtualCrop?.name || 'foto.jpg';
            const file = new File([blob], nome, { type: 'image/jpeg' });
            const url  = URL.createObjectURL(blob);
            galeriaItems.push({ id: nextGalId(), file, url, isUrl: false });
            filaCrop.shift();
            fecharCrop();
            processarFilaCrop();
        }, 'image/jpeg', 0.88);
    });

    $('btnFecharCropProduto')?.addEventListener('click', () => fecharCrop({ limpar: true }));
    $('btnCancelarCropProduto')?.addEventListener('click', () => fecharCrop({ limpar: true }));

    // =========================================================
    // SUBMISSÃO
    // =========================================================
    $('btnSalvar')?.addEventListener('click', async () => {
        const nome = $('nome')?.value.trim();
        const validas = variacoesMultiplas.filter(v => v.variacao.trim());
        if (!nome) { App.toast('warning', 'Informe o nome do produto.'); return; }
        if (!validas.length) { App.toast('warning', 'Adicione ao menos uma variação ("+ Adicionar variação").'); return; }
        const variacao = validas[0].variacao.trim();
        const variacoesPayload = validas.map(v => {
            const calc = calcularCustoVariacao(v);
            return {
                variacao_id: v.variacaoId || null,
                variacao: v.variacao.trim(),
                sku: v.sku?.trim() || '',
                preco_venda: v.preco_venda || 0,
                preco_repasse: 0,
                estoque: 0,
                quantidade_produzida: v.quantidadeProduzida || 1,
                itens_precificacao_json: JSON.stringify(v.precItens),
                custo_material: Number(calc.totalMat.toFixed(4)),
                custo_maquina: Number(calc.totalMaq.toFixed(4)),
                custo_mao_obra: Number(calc.totalMo.toFixed(4)),
                custo_total_producao: Number(calc.custoTotal.toFixed(4)),
                custo_unitario: Number(calc.custoUnit.toFixed(4)),
                preco_sugerido: Number(calc.pAdjUnit.toFixed(4)),
                precos_qtd: v.precosQtd.map(f => ({ quantidade: f.quantidade, preco_unitario: f.preco })),
                eixos: v.eixos || null
            };
        });

        const fd = new FormData();
        fd.append('nome',         nome);
        fd.append('categoria',    $('categoria')?.value.trim() || '');
        fd.append('variacao',     variacao);
        fd.append('sku',          '');
        fd.append('variacoes_json', JSON.stringify(variacoesPayload));
        if (eixosProduto.length) {
            fd.append('opcoes_json', JSON.stringify(eixosProduto.map(e => ({ nome: e.nome, valores: e.valores }))));
        }
        fd.append('descricao', $('descricao')?.value.trim() || '');
        const _qlHtml = quillEditor ? quillEditor.root.innerHTML : ($('descricao_longa')?.value || '');
        fd.append('descricao_longa', _qlHtml === '<p><br></p>' ? '' : _qlHtml);
        fd.append('status',       $('status')?.value || 'ATIVO');
        fd.append('tipo_oferta',  tipoAtivo);
        fd.append('status_fluxo', statusFluxo);
        fd.append('destino_final',destinoAtivo);
        fd.append('precificado', 'true');

        // Campos do formulário (V6.6 + específicos por tipo)
        const financ = [
            'unidade_precificacao',
            'lead_time_dias','qtd_minima','horas_estimadas','valor_hora','tipo_cobranca','subtipo_projeto',
            'itens_pacote','desconto_pacote','fornecedor','codigo_fornecedor','preco_compra','margem_revenda',
            'custo_embalagem','custo_entrega','custo_taxas','custo_extra','custo_perdas','perdas_tipo',
            'margem_percentual','canal_venda','taxa_canal_percentual','taxa_canal_fixa',
        ];
        financ.forEach(id => { if ($(id)) fd.append(id, $(id).value); });

        // Imagens — envia arquivos novos em ordem ou, se só houver URLs, envia a nova ordem
        const _fileItems = galeriaItems.filter(i => !i.isUrl && i.file);
        const _urlItems  = galeriaItems.filter(i => i.isUrl);
        if (_fileItems.length) {
            _fileItems.forEach(i => fd.append('imagens', i.file));
        } else if (_urlItems.length) {
            fd.append('galeria_ordem_json', JSON.stringify(_urlItems.map(i => i.url)));
        }

        const btn = $('btnSalvar');
        btn.disabled = true;
        $('lblSalvar').textContent = 'Salvando...';

        try {
            if (editandoId) {
                await App.api(`/produtos/${editandoId}`, { method:'PUT', body: fd });
                App.toast('success', 'Produto atualizado!');
            } else {
                await App.api('/produtos', { method:'POST', body: fd });
                App.toast('success', 'Produto cadastrado!');
            }
            setTimeout(() => window.location.href = 'produtos-lista.html', 900);
        } catch (err) {
            Swal.fire('Erro', err.message, 'error');
            btn.disabled = false;
            $('lblSalvar').textContent = 'Salvar produto';
        }
    });

    // =========================================================
    // MODO EDIÇÃO — prefill via ?id=...
    // =========================================================
    let _dadosEdicao = null; // dados do produto para preencher step 3

    async function carregarEdicao(id) {
        editandoId = id;
        $('tituloPagina').textContent    = 'Editar Produto';
        $('subtituloPagina').textContent = 'Atualize as informações do produto.';
        $('lblSalvar').textContent       = 'Atualizar produto';
        try {
            const p = await App.api(`/produtos/${id}`);

            tipoAtivo    = p.tipo_oferta   || 'PRODUTO_PROPRIO';
            destinoAtivo = p.destino_final || 'ESTOQUE';
            statusFluxo  = p.status_fluxo  || 'ATIVO';

            $('tipo_oferta').value   = tipoAtivo;
            $('destino_final').value = destinoAtivo;
            $('status_fluxo').value  = statusFluxo;
            $('produtoId').value     = id;

            // Step 2 — campos estáticos
            $('nome').value      = p.nome      || '';
            $('descricao').value = p.descricao || '';
            if (quillEditor && p.descricao_longa) {
                quillEditor.root.innerHTML = p.descricao_longa;
            }
            await carregarCategorias(p.categoria || '');

            // Carrega variações já cadastradas (ou cria uma a partir dos campos legados do produto)
            if (Array.isArray(p.variacoes) && p.variacoes.length > 0) {
                variacoesMultiplas = p.variacoes.map(v => {
                    let precItensSalvos = { materiais: [], maquinas: [], mao_obra: [] };
                    try {
                        const parsed = typeof v.itens_precificacao_json === 'string' ? JSON.parse(v.itens_precificacao_json) : v.itens_precificacao_json;
                        if (parsed && typeof parsed === 'object') {
                            if (Array.isArray(parsed.materiais)) precItensSalvos.materiais = parsed.materiais.map(m => ({ ...m, id: nextPrecId() }));
                            if (Array.isArray(parsed.maquinas))  precItensSalvos.maquinas  = parsed.maquinas.map(m => ({ ...m, id: nextPrecId() }));
                            if (Array.isArray(parsed.mao_obra))  precItensSalvos.mao_obra  = parsed.mao_obra.map(m => ({ ...m, id: nextPrecId() }));
                        }
                    } catch {}
                    let eixosSalvos = null;
                    try {
                        const parsedEixos = typeof v.eixos_json === 'string' ? JSON.parse(v.eixos_json) : v.eixos_json;
                        if (parsedEixos && typeof parsedEixos === 'object') eixosSalvos = parsedEixos;
                    } catch {}
                    return {
                        id: nextVarMultId(),
                        variacaoId: v.variacao_id,
                        variacao: v.variacao || '',
                        sku: v.sku || '',
                        preco_venda: Number(v.preco_venda || 0),
                        quantidadeProduzida: parseInt(v.quantidade_produzida, 10) || 1,
                        precItens: precItensSalvos,
                        precosQtd: (v.precos_qtd || []).map(f => ({ id: nextFaixaId(), quantidade: f.quantidade, preco: Number(f.preco_unitario || 0) })),
                        eixos: eixosSalvos
                    };
                });
            } else if (p.variacao) {
                // Backward compat: produto antigo só com campos de variação no nível do produto
                variacoesMultiplas = [{
                    id: nextVarMultId(),
                    variacaoId: p.variacao_id || null,
                    variacao: p.variacao || '',
                    sku: p.sku || '',
                    preco_venda: Number(p.preco_venda || p.preco_sugerido || 0),
                    quantidadeProduzida: parseInt(p.quantidade_produzida, 10) || 1,
                    precItens: { materiais: [], maquinas: [], mao_obra: [] },
                    precosQtd: [],
                    eixos: null,
                }];
            }
            renderVariacaoSelectOptions();
            renderVariacoesResumo();

            // Recarrega a definição dos eixos (Tamanho, Cor...) para o editor
            try {
                const parsedOpcoes = typeof p.opcoes_json === 'string' ? JSON.parse(p.opcoes_json) : p.opcoes_json;
                if (Array.isArray(parsedOpcoes)) {
                    eixosProduto = parsedOpcoes.map(e => ({ id: nextEixoId(), nome: e.nome, valores: Array.isArray(e.valores) ? e.valores : [] }));
                    renderEixos();
                }
            } catch {}

            // Guarda dados para preencher step 3 quando for renderizado
            _dadosEdicao = p;

            await carregarTemas();

            // Pula step 1, vai para step 2
            stepAtual = 2;
            renderTipos();
            renderPasso();

            // Preview galeria existente
            const urls = galeriaUrls(p);
            if (urls.length) renderPreview(urls);
        } catch (err) {
            App.toast('error', 'Erro ao carregar produto: ' + err.message);
        }
    }

    function preencherStep3Edicao() {
        const p = _dadosEdicao;
        if (!p) return;

        const set = (id, val) => { const el = $(id); if (el && val != null && val !== '') el.value = val; };
        set('unidade_precificacao',  p.unidade_precificacao);
        set('status',                p.status           || 'ATIVO');
        set('lead_time_dias',        p.lead_time_dias);
        set('qtd_minima',            p.qtd_minima);
        set('custo_embalagem',       p.custo_embalagem);
        set('custo_entrega',         p.custo_entrega);
        set('custo_taxas',           p.custo_taxas);
        set('custo_extra',           p.custo_extra);
        set('custo_perdas',          p.custo_perdas);
        set('perdas_tipo',           p.perdas_tipo);
        set('margem_percentual',     p.margem_percentual);
        set('canal_venda',           p.canal_venda);
        set('taxa_canal_percentual', p.taxa_canal_percentual);
        set('taxa_canal_fixa',       p.taxa_canal_fixa);
    }

    function galeriaUrls(p) {
        if (!p) return [];
        let galeria = p.galeria;
        if (typeof galeria === 'string') { try { galeria = JSON.parse(galeria); } catch { galeria = []; } }
        if (!Array.isArray(galeria)) galeria = [];
        const urls = galeria.map(item => typeof item === 'string' ? item : (item?.url || item?.imagem_url || null)).filter(Boolean);
        if (!urls.length && p.imagem_url) urls.push(p.imagem_url);
        return [...new Set(urls)].slice(0, 10);
    }

    // =========================================================
    // EVENT LISTENERS DA NAVEGAÇÃO
    // =========================================================
    $('btnP1Prox')?.addEventListener('click', () => irPasso(2));
    $('btnP2Ant')?.addEventListener('click', () => { stepAtual = 1; renderPasso(); });
    $('btnP2Prox')?.addEventListener('click', () => irPasso(3));
    $('btnP3Ant')?.addEventListener('click', () => { stepAtual = 2; renderPasso(); });
    $('btnP3Prox')?.addEventListener('click', () => irPasso(4));
    $('btnP4Ant')?.addEventListener('click', () => { stepAtual = 3; renderPasso(); });

    // =========================================================
    // INIT
    // =========================================================
    renderTipos();
    carregarCategorias();
    renderVariacaoSelectOptions();
    renderVariacoesResumo();

    const params = new URLSearchParams(location.search);
    const idEdit = params.get('id');
    if (idEdit) {
        carregarEdicao(idEdit);
    }
});
