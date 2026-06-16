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
            if (!$('nome')?.value.trim())    { App.toast('warning', 'Informe o nome do produto.'); return false; }
            if (!$('variacao')?.value.trim()){ App.toast('warning', 'Informe a variação.'); return false; }
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
    // PASSO 3 — PRECIFICAÇÃO UNIVERSAL V6.6
    // =========================================================

    // Estado dos itens de precificação (persiste durante a sessão do wizard)
    let precItens = { materiais: [], maquinas: [], mao_obra: [] };
    let _precItemId = 0;
    function nextPrecId() { return ++_precItemId; }

    // Resultado calculado (referenciado no submit)
    let _precCalc = {};

    function templateUniversal() {
        const comEstoque = tipoAtivo === 'PRODUTO_PROPRIO' || tipoAtivo === 'REVENDA';
        return `
        <div class="form-grid">
          <div class="form-group"><label>Variação *</label><input id="variacao2" name="variacao_p3" placeholder="Cor, tamanho, versão..."></div>
          <div class="form-group"><label>SKU</label><input id="sku2" name="sku_p3"></div>
          ${comEstoque ? `<div class="form-group"><label>Estoque central</label><input id="estoque" name="estoque" type="number" min="0" value="0"></div>` : ''}
          <div class="form-group"><label>Quantidade produzida</label><input id="quantidade_produzida" name="quantidade_produzida" type="number" step="1" min="1" value="1"></div>
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
            <small class="text-muted">Materiais, máquinas, mão de obra e margem</small>
          </div>

          <!-- Materiais / Insumos -->
          <div class="prec-bloco">
            <div class="prec-bloco-header">
              <span><i class="bx bx-package"></i> Materiais / Insumos</span>
              <button type="button" class="btn btn-small" id="btnAddMaterial"><i class="bx bx-plus"></i> Adicionar</button>
            </div>
            <div id="listaMateriaisPrec" class="prec-lista"></div>
            <div id="formAddMaterial" class="prec-add-form hidden">
              <div class="form-group mb-2"><label>Insumo cadastrado</label>
                <select id="novoMatInsumoId"><option value="">Personalizado (digite abaixo)...</option></select>
              </div>
              <div class="prec-add-row">
                <div class="form-group"><label>Material / insumo</label>
                  <input id="novoMatNome" placeholder="Ex: Filamento PLA, Papel adesivo...">
                </div>
                <div class="form-group"><label>Quantidade</label>
                  <input id="novoMatQtd" type="number" step="0.001" min="0" value="0">
                </div>
                <div class="form-group"><label>Unidade</label>
                  <select id="novoMatUnidade">
                    <option value="un">un</option><option value="g">g</option><option value="kg">kg</option>
                    <option value="ml">ml</option><option value="L">L</option><option value="folha">folha</option>
                    <option value="m²">m²</option><option value="m">m</option>
                  </select>
                </div>
                <div class="form-group"><label>Custo / unidade (R$)</label>
                  <input id="novoMatCusto" type="number" step="0.0001" min="0" value="0">
                </div>
                <div class="form-group prec-add-actions">
                  <label>&nbsp;</label>
                  <button type="button" class="btn btn-primary btn-small" id="btnConfirmMaterial"><i class="bx bx-check"></i></button>
                  <button type="button" class="btn btn-light btn-small" id="btnCancelMaterial"><i class="bx bx-x"></i></button>
                </div>
              </div>
            </div>
          </div>

          <!-- Máquinas / Recursos -->
          <div class="prec-bloco">
            <div class="prec-bloco-header">
              <span><i class="bx bx-cog"></i> Máquinas / Recursos</span>
              <button type="button" class="btn btn-small" id="btnAddMaquina"><i class="bx bx-plus"></i> Adicionar</button>
            </div>
            <div id="listaMaquinasPrec" class="prec-lista"></div>
            <div id="formAddMaquina" class="prec-add-form hidden">
              <div class="prec-add-row">
                <div class="form-group"><label>Máquina</label>
                  <select id="novoMaqId"><option value="">Selecione a máquina...</option></select>
                </div>
                <div class="form-group"><label>Tempo</label>
                  <input id="novoMaqTempo" type="number" step="0.01" min="0" value="0">
                </div>
                <div class="form-group"><label>Unidade</label>
                  <select id="novoMaqUnidade"><option value="h">hora</option><option value="min">minuto</option></select>
                </div>
                <div class="form-group"><label>Custo/h (R$)</label>
                  <input id="novoMaqCusto" type="number" step="0.0001" min="0" value="0" placeholder="automático">
                </div>
                <div class="form-group prec-add-actions">
                  <label>&nbsp;</label>
                  <button type="button" class="btn btn-primary btn-small" id="btnConfirmMaquina"><i class="bx bx-check"></i></button>
                  <button type="button" class="btn btn-light btn-small" id="btnCancelMaquina"><i class="bx bx-x"></i></button>
                </div>
              </div>
              <div class="form-group mt-2"><label>Observação</label>
                <input id="novoMaqObs" placeholder="Ex: impressão com suporte, laminação fosca...">
              </div>
            </div>
          </div>

          <!-- Mão de obra -->
          <div class="prec-bloco">
            <div class="prec-bloco-header">
              <span><i class="bx bx-user"></i> Mão de obra</span>
              <button type="button" class="btn btn-small" id="btnAddMaoObra"><i class="bx bx-plus"></i> Adicionar</button>
            </div>
            <div id="listaMaoObraPrec" class="prec-lista"></div>
            <div id="formAddMaoObra" class="prec-add-form hidden">
              <div class="prec-add-row">
                <div class="form-group"><label>Descrição</label>
                  <input id="novoMoDesc" placeholder="Ex: Limpeza, acabamento, design...">
                </div>
                <div class="form-group"><label>Tempo</label>
                  <input id="novoMoTempo" type="number" step="0.01" min="0" value="0">
                </div>
                <div class="form-group"><label>Unidade</label>
                  <select id="novoMoUnidade"><option value="h">hora</option><option value="min">minuto</option></select>
                </div>
                <div class="form-group"><label>Valor/hora (R$)</label>
                  <input id="novoMoValor" type="number" step="0.01" min="0" value="0">
                </div>
                <div class="form-group prec-add-actions">
                  <label>&nbsp;</label>
                  <button type="button" class="btn btn-primary btn-small" id="btnConfirmMaoObra"><i class="bx bx-check"></i></button>
                  <button type="button" class="btn btn-light btn-small" id="btnCancelMaoObra"><i class="bx bx-x"></i></button>
                </div>
              </div>
            </div>
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

          <!-- Resultado -->
          <div class="prec-bloco">
            <div class="pricing-result-v3">
              <div class="prec-r-row prec-r-mat"><small>Materiais</small><strong id="resMateriais">R$ 0,00</strong></div>
              <div class="prec-r-row prec-r-maq"><small>Máquinas</small><strong id="resMaquinas">R$ 0,00</strong></div>
              <div class="prec-r-row prec-r-mo"><small>Mão de obra</small><strong id="resMaoObra">R$ 0,00</strong></div>
              <div class="prec-r-row prec-r-out"><small>Outros</small><strong id="resOutros">R$ 0,00</strong></div>
              <div class="prec-r-row prec-r-perd"><small>Perdas</small><strong id="resPerdas">R$ 0,00</strong></div>
              <div class="prec-r-row prec-r-total"><small>Custo total</small><strong id="resCustoTotal">R$ 0,00</strong></div>
              <div class="prec-r-row prec-r-unit"><small>Custo unitário</small><strong id="resCustoUnitario">R$ 0,00</strong></div>
              <div class="prec-r-row prec-r-sug"><small>Preço sugerido</small><strong id="resPrecoSugerido">R$ 0,00</strong></div>
              <div class="prec-r-row prec-r-lote"><small>Preço lote</small><strong id="resPrecoLote">R$ 0,00</strong></div>
              <div class="prec-r-row prec-r-lucro"><small>Lucro unit. est.</small><strong id="resLucro">R$ 0,00</strong></div>
            </div>
            <button type="button" class="btn btn-light mt-2" id="btnAplicarPreco">
              <i class="bx bx-transfer-alt"></i> Aplicar valores calculados
            </button>
          </div>
        </div>

        <!-- Valores finais -->
        <div class="mt-3">
          <h3>Valores finais</h3>
          <div class="form-grid">
            <div class="form-group"><label>Custo de produção</label>
              <input id="custo_producao" name="custo_producao" type="number" step="0.01" min="0" value="0">
            </div>
            <div class="form-group"><label>Valor de repasse / consignação</label>
              <input id="preco_repasse" name="preco_repasse" type="number" step="0.01" min="0" value="0">
            </div>
            <div class="form-group"><label>Preço de venda final</label>
              <input id="preco_venda" name="preco_venda" type="number" step="0.01" min="0" value="0">
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
        renderListaMateriaisPrec();
        renderListaMaquinasPrec();
        renderListaMaoObraPrec();
        carregarMaquinas();
        carregarInsumos();
        calcularPrecificacaoUniversal();
        preencherStep3Edicao();
    }

    // --- Renderização das listas de itens ---

    function renderListaMateriaisPrec() {
        const el = $('listaMateriaisPrec');
        if (!el) return;
        if (!precItens.materiais.length) { el.innerHTML = ''; return; }
        el.innerHTML = precItens.materiais.map(m => {
            const total = m.quantidade * m.custo_unitario;
            return `<div class="prec-item">
              <div class="prec-item-info">
                <span class="prec-item-nome">${esc(m.nome)}${m.insumo_id ? ' <small class="text-muted">(estoque de insumos)</small>' : ''}</span>
                <span class="prec-item-detalhe">${m.quantidade} ${esc(m.unidade)} × ${money(m.custo_unitario)}/un</span>
              </div>
              <span class="prec-item-total">${money(total)}</span>
              <button type="button" class="btn btn-small btn-danger" onclick="removerPrecItem('materiais',${m.id})"><i class="bx bx-trash"></i></button>
            </div>`;
        }).join('');
    }

    function renderListaMaquinasPrec() {
        const el = $('listaMaquinasPrec');
        if (!el) return;
        if (!precItens.maquinas.length) { el.innerHTML = ''; return; }
        el.innerHTML = precItens.maquinas.map(m => {
            const horas = m.unidade_tempo === 'h' ? m.tempo : m.tempo / 60;
            const total = horas * m.custo_hora;
            return `<div class="prec-item">
              <div class="prec-item-info">
                <span class="prec-item-nome">${esc(m.nome)}</span>
                <span class="prec-item-detalhe">${m.tempo} ${m.unidade_tempo === 'h' ? 'h' : 'min'} × ${money(m.custo_hora)}/h${m.observacao ? ' · ' + esc(m.observacao) : ''}</span>
              </div>
              <span class="prec-item-total">${money(total)}</span>
              <button type="button" class="btn btn-small btn-danger" onclick="removerPrecItem('maquinas',${m.id})"><i class="bx bx-trash"></i></button>
            </div>`;
        }).join('');
    }

    function renderListaMaoObraPrec() {
        const el = $('listaMaoObraPrec');
        if (!el) return;
        if (!precItens.mao_obra.length) { el.innerHTML = ''; return; }
        el.innerHTML = precItens.mao_obra.map(m => {
            const horas = m.unidade_tempo === 'h' ? m.tempo : m.tempo / 60;
            const total = horas * m.valor_hora;
            return `<div class="prec-item">
              <div class="prec-item-info">
                <span class="prec-item-nome">${esc(m.descricao)}</span>
                <span class="prec-item-detalhe">${m.tempo} ${m.unidade_tempo === 'h' ? 'h' : 'min'} × ${money(m.valor_hora)}/h</span>
              </div>
              <span class="prec-item-total">${money(total)}</span>
              <button type="button" class="btn btn-small btn-danger" onclick="removerPrecItem('mao_obra',${m.id})"><i class="bx bx-trash"></i></button>
            </div>`;
        }).join('');
    }

    window.removerPrecItem = (tipo, id) => {
        precItens[tipo] = precItens[tipo].filter(i => i.id !== id);
        if (tipo === 'materiais')  renderListaMateriaisPrec();
        if (tipo === 'maquinas')   renderListaMaquinasPrec();
        if (tipo === 'mao_obra')   renderListaMaoObraPrec();
        calcularPrecificacaoUniversal();
    };

    // --- Cálculo universal em tempo real ---

    function calcularPrecificacaoUniversal() {
        const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const setEl = (id, v) => { const el = $(id); if (el) el.textContent = fmt(v); };

        const qtd    = Math.max(1, moedaNum('quantidade_produzida'));
        const totalMat = precItens.materiais.reduce((s, m) => s + m.quantidade * m.custo_unitario, 0);
        const totalMaq = precItens.maquinas.reduce((s, m) => {
            const h = m.unidade_tempo === 'h' ? m.tempo : m.tempo / 60;
            return s + h * m.custo_hora;
        }, 0);
        const totalMo  = precItens.mao_obra.reduce((s, m) => {
            const h = m.unidade_tempo === 'h' ? m.tempo : m.tempo / 60;
            return s + h * m.valor_hora;
        }, 0);
        const embala   = moedaNum('custo_embalagem');
        const entrega  = moedaNum('custo_entrega');
        const taxas    = moedaNum('custo_taxas');
        const extra    = moedaNum('custo_extra');
        const totalOut = embala + entrega + taxas + extra;
        const perdas   = moedaNum('custo_perdas');
        const perdasTipo = $('perdas_tipo')?.value || 'VALOR';
        const subTotal = totalMat + totalMaq + totalMo + totalOut;
        const totalPerd = perdasTipo === 'PERCENTUAL' ? subTotal * (perdas / 100) : perdas;
        const custoTotal = subTotal + totalPerd;
        const custoUnit  = custoTotal / qtd;
        const marg    = moedaNum('margem_percentual');
        const taxaP   = moedaNum('taxa_canal_percentual');
        const taxaF   = moedaNum('taxa_canal_fixa');
        const pSugUnit  = custoUnit * (1 + marg / 100);
        const divisor   = (1 - taxaP / 100) || 1;
        const pAdjUnit  = (pSugUnit + taxaF / qtd) / divisor;
        const pLote     = pAdjUnit * qtd;
        const lucro     = pAdjUnit - custoUnit;

        setEl('resMateriais',     totalMat);
        setEl('resMaquinas',      totalMaq);
        setEl('resMaoObra',       totalMo);
        setEl('resOutros',        totalOut);
        setEl('resPerdas',        totalPerd);
        setEl('resCustoTotal',    custoTotal);
        setEl('resCustoUnitario', custoUnit);
        setEl('resPrecoSugerido', pAdjUnit);
        setEl('resPrecoLote',     pLote);
        setEl('resLucro',         lucro);

        _precCalc = { totalMat, totalMaq, totalMo, totalOut, totalPerd, custoTotal, custoUnit, pAdjUnit, pLote, lucro, qtd };

        // Auto-sugestão: preenche preco_venda se ainda não foi definido pelo usuário
        if (pAdjUnit > 0 && moedaNum('preco_venda') === 0) {
            setVal('preco_venda', pAdjUnit);
            setVal('custo_producao', custoUnit);
        }
        if (custoUnit > 0 && moedaNum('custo_producao') === 0) {
            setVal('custo_producao', custoUnit);
        }
    }

    // --- Eventos do passo 3 ---

    function bindStep3Events() {
        // Revenda: auto-calcular
        ['preco_compra','margem_revenda'].forEach(id => {
            $(id)?.addEventListener('input', () => {
                const compra  = moedaNum('preco_compra');
                const margem  = moedaNum('margem_revenda');
                if (compra > 0) {
                    setVal('custo_producao', compra);
                    setVal('preco_venda', compra * (1 + margem / 100));
                }
            });
        });

        // Serviço / Projeto: auto-calcular por hora
        ['horas_estimadas','valor_hora'].forEach(id => {
            $(id)?.addEventListener('input', () => {
                if ($('tipo_cobranca')?.value === 'HORA') {
                    const h  = moedaNum('horas_estimadas');
                    const vh = moedaNum('valor_hora');
                    if (h > 0 && vh > 0) setVal('preco_venda', h * vh);
                }
            });
        });

        // Campos que disparam recálculo universal
        ['custo_embalagem','custo_entrega','custo_taxas','custo_extra',
         'custo_perdas','perdas_tipo','margem_percentual',
         'taxa_canal_percentual','taxa_canal_fixa','quantidade_produzida'].forEach(id => {
            $(id)?.addEventListener('input',  calcularPrecificacaoUniversal);
            $(id)?.addEventListener('change', calcularPrecificacaoUniversal);
        });

        // Aplicar valores calculados
        $('btnAplicarPreco')?.addEventListener('click', () => {
            if (_precCalc.custoUnit > 0) setVal('custo_producao', _precCalc.custoUnit);
            if (_precCalc.pAdjUnit  > 0) setVal('preco_venda',    _precCalc.pAdjUnit);
            App.toast('success', 'Valores aplicados!');
        });

        // === MATERIAIS ===
        $('btnAddMaterial')?.addEventListener('click', () => {
            $('formAddMaterial')?.classList.toggle('hidden');
            $('novoMatNome')?.focus();
        });
        $('novoMatInsumoId')?.addEventListener('change', () => {
            const i = insumos.find(x => String(x.id) === String($('novoMatInsumoId')?.value));
            if (i) {
                if ($('novoMatNome'))    $('novoMatNome').value    = i.nome;
                if ($('novoMatUnidade')) $('novoMatUnidade').value = i.unidade || 'un';
                if ($('novoMatCusto'))   $('novoMatCusto').value   = i.custo_unitario || 0;
            }
        });
        $('btnCancelMaterial')?.addEventListener('click', () => {
            $('formAddMaterial')?.classList.add('hidden');
            _limparFormMat();
        });
        $('btnConfirmMaterial')?.addEventListener('click', () => {
            const nome   = $('novoMatNome')?.value.trim();
            const qtd    = parseFloat($('novoMatQtd')?.value || '0') || 0;
            const custo  = parseFloat($('novoMatCusto')?.value || '0') || 0;
            const unidade = $('novoMatUnidade')?.value || 'un';
            const insumoId = $('novoMatInsumoId')?.value ? parseInt($('novoMatInsumoId').value, 10) : null;
            if (!nome)  { App.toast('warning', 'Informe o nome do material.'); return; }
            if (qtd <= 0) { App.toast('warning', 'Informe a quantidade.'); return; }
            precItens.materiais.push({ id: nextPrecId(), nome, quantidade: qtd, unidade, custo_unitario: custo, insumo_id: insumoId });
            renderListaMateriaisPrec();
            calcularPrecificacaoUniversal();
            $('formAddMaterial')?.classList.add('hidden');
            _limparFormMat();
        });

        // === MÁQUINAS ===
        $('btnAddMaquina')?.addEventListener('click', () => {
            $('formAddMaquina')?.classList.toggle('hidden');
        });
        $('novoMaqId')?.addEventListener('change', () => {
            const m = maquinas.find(x => String(x.id) === String($('novoMaqId')?.value));
            if (m) setVal('novoMaqCusto', m.custo_total_hora || 0);
        });
        $('btnCancelMaquina')?.addEventListener('click', () => {
            $('formAddMaquina')?.classList.add('hidden');
            _limparFormMaq();
        });
        $('btnConfirmMaquina')?.addEventListener('click', () => {
            const maqId = $('novoMaqId')?.value;
            const m = maquinas.find(x => String(x.id) === maqId);
            if (!maqId) { App.toast('warning', 'Selecione uma máquina.'); return; }
            const tempo = parseFloat($('novoMaqTempo')?.value || '0') || 0;
            if (tempo <= 0) { App.toast('warning', 'Informe o tempo de uso.'); return; }
            const unidade_tempo = $('novoMaqUnidade')?.value || 'h';
            const custo_hora    = parseFloat($('novoMaqCusto')?.value || '0') || (m?.custo_total_hora || 0);
            const observacao    = $('novoMaqObs')?.value.trim() || '';
            precItens.maquinas.push({ id: nextPrecId(), maquina_id: m?.id || null, nome: m?.nome || 'Máquina', tipo: m?.tipo || '', tempo, unidade_tempo, custo_hora, observacao });
            renderListaMaquinasPrec();
            calcularPrecificacaoUniversal();
            $('formAddMaquina')?.classList.add('hidden');
            _limparFormMaq();
        });

        // === MÃO DE OBRA ===
        $('btnAddMaoObra')?.addEventListener('click', () => {
            $('formAddMaoObra')?.classList.toggle('hidden');
            $('novoMoDesc')?.focus();
        });
        $('btnCancelMaoObra')?.addEventListener('click', () => {
            $('formAddMaoObra')?.classList.add('hidden');
            _limparFormMo();
        });
        $('btnConfirmMaoObra')?.addEventListener('click', () => {
            const desc    = $('novoMoDesc')?.value.trim();
            const tempo   = parseFloat($('novoMoTempo')?.value || '0') || 0;
            const valorH  = parseFloat($('novoMoValor')?.value || '0') || 0;
            const unidade_tempo = $('novoMoUnidade')?.value || 'h';
            if (!desc)    { App.toast('warning', 'Informe a descrição da atividade.'); return; }
            if (tempo <= 0) { App.toast('warning', 'Informe o tempo.'); return; }
            precItens.mao_obra.push({ id: nextPrecId(), descricao: desc, tempo, unidade_tempo, valor_hora: valorH });
            renderListaMaoObraPrec();
            calcularPrecificacaoUniversal();
            $('formAddMaoObra')?.classList.add('hidden');
            _limparFormMo();
        });
    }

    function _limparFormMat() {
        if ($('novoMatNome'))     $('novoMatNome').value     = '';
        if ($('novoMatQtd'))      $('novoMatQtd').value      = '0';
        if ($('novoMatCusto'))    $('novoMatCusto').value    = '0';
        if ($('novoMatInsumoId')) $('novoMatInsumoId').value = '';
    }
    function _limparFormMaq() {
        if ($('novoMaqId'))    $('novoMaqId').value    = '';
        if ($('novoMaqTempo')) $('novoMaqTempo').value = '0';
        if ($('novoMaqCusto')) $('novoMaqCusto').value = '0';
        if ($('novoMaqObs'))   $('novoMaqObs').value   = '';
    }
    function _limparFormMo() {
        if ($('novoMoDesc'))   $('novoMoDesc').value  = '';
        if ($('novoMoTempo'))  $('novoMoTempo').value = '0';
        if ($('novoMoValor'))  $('novoMoValor').value = '0';
    }

    async function carregarMaquinas() {
        try {
            maquinas = await App.api('/maquinas');
            const ativos = maquinas.filter(m => String(m.status || 'ATIVA') !== 'INATIVA');
            const opts = ativos.map(m => `<option value="${m.id}">${esc(m.nome)}${m.modelo ? ' - '+esc(m.modelo) : ''} • ${money(m.custo_total_hora)}/h</option>`).join('');
            const selNew = $('novoMaqId');
            if (selNew) selNew.innerHTML = '<option value="">Selecione a máquina...</option>' + opts;
        } catch { maquinas = []; }
    }

    async function carregarInsumos() {
        try {
            insumos = await App.api('/insumos');
            const ativos = insumos.filter(i => String(i.status || 'ATIVO') !== 'INATIVO');
            const opts = ativos.map(i => `<option value="${i.id}">${esc(i.nome)} • ${money(i.custo_unitario)}/${esc(i.unidade)} • estoque: ${App.number(i.estoque_atual)}</option>`).join('');
            const selNew = $('novoMatInsumoId');
            if (selNew) selNew.innerHTML = '<option value="">Personalizado (digite abaixo)...</option>' + opts;
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
        const variacao = $('variacao')?.value.trim();
        if (!nome || !variacao) { App.toast('warning','Preencha nome e variação (passo 2).'); return; }

        const fd = new FormData();
        fd.append('nome',         nome);
        fd.append('categoria',    $('categoria')?.value.trim() || '');
        fd.append('variacao',     $('variacao2')?.value.trim() || variacao);
        fd.append('sku',          $('sku2')?.value.trim() || $('sku')?.value.trim() || '');
        fd.append('descricao', $('descricao')?.value.trim() || '');
        const _qlHtml = quillEditor ? quillEditor.root.innerHTML : ($('descricao_longa')?.value || '');
        fd.append('descricao_longa', _qlHtml === '<p><br></p>' ? '' : _qlHtml);
        fd.append('status',       $('status')?.value || 'ATIVO');
        fd.append('estoque',      $('estoque')?.value || '0');
        fd.append('tipo_oferta',  tipoAtivo);
        fd.append('status_fluxo', statusFluxo);
        fd.append('destino_final',destinoAtivo);
        fd.append('precificado', 'true');

        // Campos do formulário (inclui campos V6.6 + backward compat)
        const financ = [
            'custo_producao','preco_repasse','preco_venda',
            'quantidade_produzida','unidade_precificacao',
            // backward compat (seguros se não existirem no template)
            'peso_gramas','valor_kg_material','maquina_id','tempo_maquina_horas','valor_hora_maquina','custo_energia','custo_acessorios',
            // campos V6.6 presentes no template universal
            'custo_embalagem','custo_entrega','custo_taxas','custo_extra','custo_perdas','perdas_tipo',
            'margem_percentual','canal_venda','taxa_canal_percentual','taxa_canal_fixa',
            // campos específicos por tipo
            'lead_time_dias','qtd_minima','horas_estimadas','valor_hora','tipo_cobranca','subtipo_projeto',
            'itens_pacote','desconto_pacote','fornecedor','codigo_fornecedor','preco_compra','margem_revenda',
        ];
        financ.forEach(id => { if ($(id)) fd.append(id, $(id).value); });

        // Totais calculados (V6.6)
        fd.append('itens_precificacao_json',  JSON.stringify(precItens));
        fd.append('custo_material',           String((_precCalc.totalMat  || 0).toFixed(4)));
        fd.append('custo_maquina',            String((_precCalc.totalMaq  || 0).toFixed(4)));
        fd.append('custo_mao_obra',           String((_precCalc.totalMo   || 0).toFixed(4)));
        fd.append('custo_total_producao',     String((_precCalc.custoTotal|| 0).toFixed(4)));
        fd.append('custo_unitario',           String((_precCalc.custoUnit || 0).toFixed(4)));
        fd.append('preco_sugerido',           String((_precCalc.pAdjUnit  || 0).toFixed(4)));
        fd.append('preco_total_lote',         String((_precCalc.pLote     || 0).toFixed(4)));
        // Snapshot da 1ª máquina para backward compat
        if (precItens.maquinas.length > 0) {
            const f = precItens.maquinas[0];
            if (!$('maquina_id'))          fd.append('maquina_id',           String(f.maquina_id || ''));
            if (!$('tempo_maquina_horas')) fd.append('tempo_maquina_horas',  String(f.unidade_tempo === 'h' ? f.tempo : f.tempo / 60));
            if (!$('valor_hora_maquina'))  fd.append('valor_hora_maquina',   String(f.custo_hora));
            fd.append('maquina_nome_snapshot', f.nome);
        }

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
            $('categoria').value = p.categoria || '';
            $('variacao').value  = p.variacao  || '';
            $('sku').value       = p.sku       || '';
            $('descricao').value = p.descricao || '';
            if (quillEditor && p.descricao_longa) {
                quillEditor.root.innerHTML = p.descricao_longa;
            }

            // Guarda dados para preencher step 3 quando for renderizado
            _dadosEdicao = p;

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

        // Campos do template universal (renderizados dinamicamente)
        const set = (id, val) => { const el = $(id); if (el && val != null && val !== '') el.value = val; };
        set('variacao2',             p.variacao         || '');
        set('sku2',                  p.sku              || '');
        set('estoque',               p.estoque_central  ?? 0);
        set('quantidade_produzida',  p.quantidade_produzida || 1);
        set('unidade_precificacao',  p.unidade_precificacao);
        set('status',                p.status           || 'ATIVO');
        // Campos de variação (lead_time, qtd_min vêm de produto_variacoes)
        set('lead_time_dias',        p.lead_time_dias);
        set('qtd_minima',            p.qtd_minima);
        // Outros custos (existem na tabela precificacoes)
        set('custo_embalagem',       p.custo_embalagem);
        set('custo_entrega',         p.custo_entrega);
        set('custo_taxas',           p.custo_taxas);
        set('custo_extra',           p.custo_extra);
        set('custo_perdas',          p.custo_perdas);
        set('perdas_tipo',           p.perdas_tipo);
        // Margem/canal
        set('margem_percentual',     p.margem_percentual);
        set('canal_venda',           p.canal_venda);
        set('taxa_canal_percentual', p.taxa_canal_percentual);
        set('taxa_canal_fixa',       p.taxa_canal_fixa);
        // Valores finais
        set('custo_producao',        p.custo_total_producao || p.custo_producao);
        set('preco_repasse',         p.preco_repasse);
        set('preco_venda',           p.preco_sugerido || p.preco_venda);

        // Restaura itens de precificação
        if (p.itens_precificacao_json) {
            try {
                const itens = typeof p.itens_precificacao_json === 'string'
                    ? JSON.parse(p.itens_precificacao_json)
                    : p.itens_precificacao_json;
                if (itens && typeof itens === 'object') {
                    if (Array.isArray(itens.materiais)) precItens.materiais = itens.materiais;
                    if (Array.isArray(itens.maquinas))  precItens.maquinas  = itens.maquinas;
                    if (Array.isArray(itens.mao_obra))  precItens.mao_obra  = itens.mao_obra;
                    renderListaMateriaisPrec();
                    renderListaMaquinasPrec();
                    renderListaMaoObraPrec();
                }
            } catch {}
        }

        calcularPrecificacaoUniversal();
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

    const params = new URLSearchParams(location.search);
    const idEdit = params.get('id');
    if (idEdit) {
        carregarEdicao(idEdit);
    }
});
