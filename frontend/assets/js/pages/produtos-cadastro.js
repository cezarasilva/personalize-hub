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

    // crop
    let cropperProduto  = null;
    let cropObjectUrl   = null;
    let arquivoAtualCrop = null;
    let filaCrop        = [];
    let totalFilaCrop   = 0;
    let imagensCortadasFiles = [];
    let previewObjectUrls    = [];

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
    // PASSO 3 — PRECIFICAÇÃO (dinâmico por tipo)
    // =========================================================
    const TEMPLATE_PRECO_SIMPLES = `
        <div class="form-grid">
            <div class="form-group"><label>Variação</label><input id="variacao2" name="variacao_p3" placeholder="Cor, tamanho, versão..."></div>
            <div class="form-group"><label>SKU</label><input id="sku2" name="sku_p3" placeholder="Gerado se vazio"></div>
            <div class="form-group"><label>Custo de produção / execução</label><input id="custo_producao" name="custo_producao" type="number" step="0.01" min="0" value="0"></div>
            <div class="form-group"><label>Valor de repasse / consignação</label><input id="preco_repasse" name="preco_repasse" type="number" step="0.01" min="0" value="0"></div>
            <div class="form-group"><label>Preço de venda final</label><input id="preco_venda" name="preco_venda" type="number" step="0.01" min="0" value="0"></div>
            <div class="form-group"><label>Status</label>
                <select id="status" name="status">
                    <option value="ATIVO">ATIVO</option>
                    <option value="INATIVO">INATIVO</option>
                    <option value="SEM ESTOQUE">SEM ESTOQUE</option>
                    <option value="SOB ENCOMENDA">SOB ENCOMENDA</option>
                    <option value="EM TESTE">EM TESTE</option>
                </select>
            </div>
        </div>`;

    const TEMPLATES_STEP3 = {
        PRODUTO_PROPRIO: () => `
            <div class="form-grid">
                <div class="form-group"><label>Variação *</label><input id="variacao2" name="variacao_p3" placeholder="Cor, tamanho, modelo..."></div>
                <div class="form-group"><label>SKU</label><input id="sku2" name="sku_p3"></div>
                <div class="form-group"><label>Estoque central</label><input id="estoque" name="estoque" type="number" min="0" value="0"></div>
                <div class="form-group"><label>Status</label>
                    <select id="status" name="status">
                        <option value="ATIVO">ATIVO</option><option value="INATIVO">INATIVO</option>
                        <option value="SEM ESTOQUE">SEM ESTOQUE</option><option value="EM TESTE">EM TESTE</option>
                    </select>
                </div>
            </div>
            <div class="choice-grid mt-3">
                <button type="button" class="choice-card ativo" data-precificar="sim"><strong>Calcular precificação</strong><small>Material, máquina, energia e margem.</small></button>
                <button type="button" class="choice-card" data-precificar="nao"><strong>Informar valores manualmente</strong><small>Já sei o custo e o preço de venda.</small></button>
            </div>
            <div id="blocoPrecificacao" class="pricing-panel mt-3">
                <h3>Precificação por lote</h3>
                <div class="form-grid">
                    <div class="form-group"><label>Quantidade produzida</label><input id="quantidade_produzida" name="quantidade_produzida" type="number" step="1" min="1" value="1"></div>
                    <div class="form-group"><label>Unidade</label>
                        <select id="unidade_precificacao" name="unidade_precificacao">
                            <option>UNIDADE</option><option>KIT</option><option>CARTELA</option><option>PAR</option><option>LOTE</option>
                        </select>
                    </div>
                    <div class="form-group"><label>Peso/material total (g)</label><input id="peso_gramas" name="peso_gramas" type="number" step="0.01" min="0" value="0"></div>
                    <div class="form-group"><label>Valor do kg material</label><input id="valor_kg_material" name="valor_kg_material" type="number" step="0.01" min="0" value="100"></div>
                    <div class="form-group"><label>Máquina</label>
                        <select id="maquina_id" name="maquina_id"><option value="">Sem máquina</option></select>
                    </div>
                    <div class="form-group"><label>Tempo máquina (h)</label><input id="tempo_maquina_horas" name="tempo_maquina_horas" type="number" step="0.01" min="0" value="0"></div>
                    <div class="form-group"><label>Valor hora máquina</label><input id="valor_hora_maquina" name="valor_hora_maquina" type="number" step="0.01" min="0" value="1"></div>
                    <div class="form-group"><label>Energia</label><input id="custo_energia" name="custo_energia" type="number" step="0.01" min="0" value="0"></div>
                    <div class="form-group"><label>Mão de obra</label><input id="custo_mao_obra" name="custo_mao_obra" type="number" step="0.01" min="0" value="0"></div>
                    <div class="form-group"><label>Embalagem</label><input id="custo_embalagem" name="custo_embalagem" type="number" step="0.01" min="0" value="0"></div>
                    <div class="form-group"><label>Acessórios</label><input id="custo_acessorios" name="custo_acessorios" type="number" step="0.01" min="0" value="0"></div>
                    <div class="form-group"><label>Perdas/refugo</label><input id="custo_perdas" name="custo_perdas" type="number" step="0.01" min="0" value="0"></div>
                    <div class="form-group"><label>Extras</label><input id="custo_extra" name="custo_extra" type="number" step="0.01" min="0" value="0"></div>
                    <div class="form-group"><label>Markup %</label><input id="margem_percentual" name="margem_percentual" type="number" step="0.01" min="0" value="40"><small class="text-muted">100% = dobra o custo</small></div>
                    <div class="form-group"><label>Canal de venda</label>
                        <select id="canal_venda" name="canal_venda">
                            <option>Venda direta</option><option>Consignação</option><option>Revendedor</option>
                            <option>Atacado</option><option>Shopee</option><option>Mercado Livre</option>
                        </select>
                    </div>
                    <div class="form-group"><label>Taxa canal %</label><input id="taxa_canal_percentual" name="taxa_canal_percentual" type="number" step="0.01" min="0" value="0"></div>
                    <div class="form-group"><label>Taxa fixa canal</label><input id="taxa_canal_fixa" name="taxa_canal_fixa" type="number" step="0.01" min="0" value="0"></div>
                </div>
                <div class="pricing-result-v2 mt-3">
                    <div><small>Custo material</small><strong id="resMaterial">R$ 0,00</strong></div>
                    <div><small>Custo máquina</small><strong id="resMaquina">R$ 0,00</strong></div>
                    <div><small>Custo total/lote</small><strong id="resCustoTotal">R$ 0,00</strong></div>
                    <div><small>Custo unitário</small><strong id="resCustoUnitario">R$ 0,00</strong></div>
                    <div><small>Preço sugerido</small><strong id="resPrecoSugerido">R$ 0,00</strong></div>
                    <div><small>Preço total lote</small><strong id="resPrecoLote">R$ 0,00</strong></div>
                </div>
                <button type="button" class="btn btn-light mt-2" id="btnAplicarPreco">Aplicar valores calculados</button>
            </div>
            <div class="manual-values mt-3">
                <h3>Valores finais</h3>
                <div class="form-grid">
                    <div class="form-group"><label>Custo produção</label><input id="custo_producao" name="custo_producao" type="number" step="0.01" min="0" value="0"></div>
                    <div class="form-group"><label>Valor repasse / consignação</label><input id="preco_repasse" name="preco_repasse" type="number" step="0.01" min="0" value="0"></div>
                    <div class="form-group"><label>Preço de venda final</label><input id="preco_venda" name="preco_venda" type="number" step="0.01" min="0" value="0"></div>
                </div>
            </div>`,

        SOB_ENCOMENDA: () => `
            ${TEMPLATE_PRECO_SIMPLES}
            <div class="form-grid mt-3">
                <div class="form-group">
                    <label>Prazo de produção (dias)</label>
                    <input id="lead_time_dias" name="lead_time_dias" type="number" min="1" value="7" placeholder="Ex.: 7">
                    <small class="text-muted">Tempo médio para fabricar após pedido.</small>
                </div>
                <div class="form-group">
                    <label>Quantidade mínima de pedido</label>
                    <input id="qtd_minima" name="qtd_minima" type="number" min="1" value="1">
                </div>
            </div>`,

        SERVICO: () => `
            <div class="form-grid">
                <div class="form-group">
                    <label>Tipo de cobrança</label>
                    <select id="tipo_cobranca" name="tipo_cobranca">
                        <option value="FIXO">Preço fixo</option>
                        <option value="HORA">Por hora</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Horas estimadas</label>
                    <input id="horas_estimadas" name="horas_estimadas" type="number" step="0.5" min="0" value="1">
                </div>
                <div class="form-group">
                    <label>Valor/hora (R$)</label>
                    <input id="valor_hora" name="valor_hora" type="number" step="0.01" min="0" value="0">
                    <small class="text-muted">Se por hora: preço = horas × valor/hora.</small>
                </div>
                <div class="form-group">
                    <label>Custo interno</label>
                    <input id="custo_producao" name="custo_producao" type="number" step="0.01" min="0" value="0">
                    <small class="text-muted">Não exibido ao cliente.</small>
                </div>
                <div class="form-group">
                    <label>Valor de repasse</label>
                    <input id="preco_repasse" name="preco_repasse" type="number" step="0.01" min="0" value="0">
                </div>
                <div class="form-group">
                    <label>Preço de venda final</label>
                    <input id="preco_venda" name="preco_venda" type="number" step="0.01" min="0" value="0">
                </div>
                <div class="form-group">
                    <label>Status</label>
                    <select id="status" name="status">
                        <option value="ATIVO">ATIVO</option><option value="INATIVO">INATIVO</option><option value="EM TESTE">EM TESTE</option>
                    </select>
                </div>
            </div>`,

        PROJETO_DIGITAL: () => `
            <div class="form-grid">
                <div class="form-group">
                    <label>Tipo de projeto</label>
                    <select id="subtipo_projeto" name="subtipo_projeto">
                        <option>Site institucional</option><option>E-commerce</option><option>Aplicativo mobile</option>
                        <option>Sistema web</option><option>Landing page</option><option>Identidade visual</option><option>Outro</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Prazo estimado (dias)</label>
                    <input id="lead_time_dias" name="lead_time_dias" type="number" min="1" value="30">
                </div>
                <div class="form-group">
                    <label>Tipo de cobrança</label>
                    <select id="tipo_cobranca" name="tipo_cobranca">
                        <option value="FIXO">Preço fixo</option><option value="HORA">Por hora</option><option value="ETAPA">Por etapa</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Horas estimadas</label>
                    <input id="horas_estimadas" name="horas_estimadas" type="number" step="1" min="0" value="0">
                </div>
                <div class="form-group">
                    <label>Custo interno</label>
                    <input id="custo_producao" name="custo_producao" type="number" step="0.01" min="0" value="0">
                </div>
                <div class="form-group">
                    <label>Valor de repasse</label>
                    <input id="preco_repasse" name="preco_repasse" type="number" step="0.01" min="0" value="0">
                </div>
                <div class="form-group">
                    <label>Preço de venda final</label>
                    <input id="preco_venda" name="preco_venda" type="number" step="0.01" min="0" value="0">
                </div>
                <div class="form-group">
                    <label>Status</label>
                    <select id="status" name="status">
                        <option value="ATIVO">ATIVO</option><option value="INATIVO">INATIVO</option><option value="EM TESTE">EM TESTE</option>
                    </select>
                </div>
            </div>`,

        REVENDA: () => `
            <div class="form-grid">
                <div class="form-group"><label>Variação</label><input id="variacao2" name="variacao_p3" placeholder="Cor, tamanho..."></div>
                <div class="form-group"><label>SKU</label><input id="sku2" name="sku_p3"></div>
                <div class="form-group">
                    <label>Fornecedor</label>
                    <input id="fornecedor" name="fornecedor" placeholder="Nome do fornecedor">
                </div>
                <div class="form-group">
                    <label>Código do fornecedor</label>
                    <input id="codigo_fornecedor" name="codigo_fornecedor" placeholder="Referência do fornecedor">
                </div>
                <div class="form-group">
                    <label>Preço de compra (R$)</label>
                    <input id="preco_compra" name="preco_compra" type="number" step="0.01" min="0" value="0" id="preco_compra">
                </div>
                <div class="form-group">
                    <label>Margem de lucro (%)</label>
                    <input id="margem_revenda" name="margem_revenda" type="number" step="0.01" min="0" value="30">
                    <small class="text-muted">Preço de venda = compra × (1 + margem/100)</small>
                </div>
                <div class="form-group">
                    <label>Custo produção (custo total)</label>
                    <input id="custo_producao" name="custo_producao" type="number" step="0.01" min="0" value="0">
                </div>
                <div class="form-group">
                    <label>Valor de repasse</label>
                    <input id="preco_repasse" name="preco_repasse" type="number" step="0.01" min="0" value="0">
                </div>
                <div class="form-group">
                    <label>Preço de venda final</label>
                    <input id="preco_venda" name="preco_venda" type="number" step="0.01" min="0" value="0">
                    <small class="text-muted">Calculado automaticamente pela margem.</small>
                </div>
                <div class="form-group">
                    <label>Estoque inicial</label>
                    <input id="estoque" name="estoque" type="number" min="0" value="0">
                </div>
                <div class="form-group">
                    <label>Status</label>
                    <select id="status" name="status">
                        <option value="ATIVO">ATIVO</option><option value="INATIVO">INATIVO</option><option value="SEM ESTOQUE">SEM ESTOQUE</option>
                    </select>
                </div>
            </div>`,

        PACOTE: () => `
            ${TEMPLATE_PRECO_SIMPLES}
            <div class="form-group mt-3">
                <label>Itens do pacote</label>
                <textarea id="itens_pacote" name="itens_pacote" placeholder="Descreva os itens incluídos neste pacote/combo, um por linha.&#10;Ex.:&#10;2x Saboneteira personalizada&#10;1x Suporte de escova de dentes&#10;1x Porta-sabão líquido"></textarea>
            </div>
            <div class="form-grid mt-2">
                <div class="form-group">
                    <label>Desconto do pacote (%)</label>
                    <input id="desconto_pacote" name="desconto_pacote" type="number" step="0.01" min="0" value="0">
                    <small class="text-muted">Desconto sobre a soma dos itens individuais.</small>
                </div>
            </div>`,
    };

    function renderStep3() {
        const content = $('step3Content');
        if (!content) return;
        renderBadge('badge3');
        const fn = TEMPLATES_STEP3[tipoAtivo];
        content.innerHTML = fn ? fn() : TEMPLATE_PRECO_SIMPLES;
        bindStep3Events();
        carregarMaquinas();
    }

    function bindStep3Events() {
        // Escolha precificação vs manual (PRODUTO_PROPRIO)
        document.querySelectorAll('[data-precificar]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-precificar]').forEach(b => b.classList.remove('ativo'));
                btn.classList.add('ativo');
                const usar = btn.dataset.precificar === 'sim';
                $('precificado').value = String(usar);
                const bloco = $('blocoPrecificacao');
                if (bloco) bloco.style.display = usar ? '' : 'none';
            });
        });

        // Cálculo de precificação em tempo real
        const camposCalc = ['quantidade_produzida','peso_gramas','valor_kg_material','tempo_maquina_horas',
            'valor_hora_maquina','custo_energia','custo_mao_obra','custo_embalagem','custo_acessorios',
            'custo_perdas','custo_extra','margem_percentual','taxa_canal_percentual','taxa_canal_fixa'];
        camposCalc.forEach(id => $( id)?.addEventListener('input', calcularPrecificacao));

        $('maquina_id')?.addEventListener('change', () => {
            const m = maquinas.find(x => String(x.id) === String($('maquina_id')?.value));
            if (m) setVal('valor_hora_maquina', m.custo_total_hora || 0);
            calcularPrecificacao();
        });

        $('btnAplicarPreco')?.addEventListener('click', () => {
            const custo = moedaNum('resCustoUnitario') || 0;
            const sugerido = moedaNum('resPrecoSugerido') || 0;
            if (custo > 0) setVal('custo_producao', custo);
            if (sugerido > 0) setVal('preco_venda', sugerido);
            App.toast('success', 'Valores aplicados!');
        });

        // Revenda: auto-calcular preço de venda
        ['preco_compra', 'margem_revenda'].forEach(id => {
            $(id)?.addEventListener('input', () => {
                const compra = moedaNum('preco_compra');
                const margem = moedaNum('margem_revenda');
                if (compra > 0) {
                    setVal('custo_producao', compra);
                    setVal('preco_venda', compra * (1 + margem / 100));
                }
            });
        });

        // Serviço: auto-calcular preço por hora
        ['horas_estimadas','valor_hora'].forEach(id => {
            $(id)?.addEventListener('input', () => {
                const tipo = $('tipo_cobranca')?.value;
                if (tipo === 'HORA') {
                    const horas = moedaNum('horas_estimadas');
                    const vh    = moedaNum('valor_hora');
                    if (horas > 0 && vh > 0) setVal('preco_venda', horas * vh);
                }
            });
        });
    }

    function calcularPrecificacao() {
        const qtd   = Math.max(1, moedaNum('quantidade_produzida'));
        const peso  = moedaNum('peso_gramas');
        const vkg   = moedaNum('valor_kg_material');
        const tMaq  = moedaNum('tempo_maquina_horas');
        const vHMaq = moedaNum('valor_hora_maquina');
        const energ = moedaNum('custo_energia');
        const maoOb = moedaNum('custo_mao_obra');
        const embal = moedaNum('custo_embalagem');
        const acess = moedaNum('custo_acessorios');
        const perd  = moedaNum('custo_perdas');
        const extra = moedaNum('custo_extra');
        const marg  = moedaNum('margem_percentual');
        const taxaP = moedaNum('taxa_canal_percentual');
        const taxaF = moedaNum('taxa_canal_fixa');

        const cMat  = (peso / 1000) * vkg;
        const cMaq  = tMaq * vHMaq;
        const cTot  = cMat + cMaq + energ + maoOb + embal + acess + perd + extra;
        const cUnit = cTot / qtd;
        const pSug  = cUnit * (1 + marg / 100);
        const pAdjUnit = (pSug + taxaF / qtd) / (1 - taxaP / 100 || 1);
        const pLote = pAdjUnit * qtd;

        const fmt = (v) => v.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
        const set = (id, v) => { const el = $(id); if (el) el.textContent = fmt(v); };
        set('resMaterial', cMat);
        set('resMaquina', cMaq);
        set('resCustoTotal', cTot);
        set('resCustoUnitario', cUnit);
        set('resPrecoSugerido', pAdjUnit);
        set('resPrecoLote', pLote);
    }

    async function carregarMaquinas() {
        const sel = $('maquina_id');
        if (!sel) return;
        try {
            maquinas = await App.api('/maquinas');
            const opts = maquinas.filter(m => String(m.status || 'ATIVA') !== 'INATIVA')
                .map(m => `<option value="${m.id}">${esc(m.nome)} ${m.modelo ? '- '+esc(m.modelo) : ''} • ${money(m.custo_total_hora)}/h</option>`)
                .join('');
            sel.innerHTML = '<option value="">Sem máquina</option>' + opts;
        } catch { maquinas = []; }
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
    function limparPreviewUrls() { previewObjectUrls.forEach(u => URL.revokeObjectURL(u)); previewObjectUrls = []; }
    function fecharCrop({ limpar = false } = {}) {
        modalCrop.classList.add('hidden');
        modalCrop.setAttribute('aria-hidden','true');
        destruirCropper();
        if (limpar) { inputImagens.value = ''; imagensCortadasFiles = []; filaCrop = []; totalFilaCrop = 0; renderPreview(); }
    }

    function renderPreview(urlsAtuais = null) {
        limparPreviewUrls();
        let urls = [];
        if (imagensCortadasFiles.length) {
            urls = imagensCortadasFiles.map(f => { const u = URL.createObjectURL(f); previewObjectUrls.push(u); return u; });
        } else if (urlsAtuais) {
            urls = urlsAtuais;
        }
        if (!urls.length) { preview.innerHTML = '<div class="gallery-preview-empty">Sem fotos selecionadas</div>'; return; }
        const grid = document.createElement('div');
        grid.className = 'gallery-preview-grid';
        urls.forEach((url, i) => {
            const item = document.createElement('div');
            item.className = 'gallery-preview-item';
            item.innerHTML = `<img src="${url}" alt="Foto ${i+1}"><span>${i === 0 ? '★ Principal' : `${i+1}ª`}</span>`;
            grid.appendChild(item);
        });
        preview.innerHTML = '';
        preview.appendChild(grid);
    }

    function abrirCrop(file) {
        arquivoAtualCrop = file;
        if (cropObjectUrl) URL.revokeObjectURL(cropObjectUrl);
        cropObjectUrl = URL.createObjectURL(file);
        imagemCrop.src = cropObjectUrl;
        modalCrop.classList.remove('hidden');
        modalCrop.setAttribute('aria-hidden','false');
        const idx = totalFilaCrop - filaCrop.length;
        cropStatus.textContent = `Foto ${idx + 1} de ${totalFilaCrop}`;
        setTimeout(() => {
            destruirCropper();
            cropperProduto = new Cropper(imagemCrop, { viewMode: 1, autoCropArea: 1, movable: true, zoomable: true, rotatable: true });
        }, 200);
    }

    function processarFilaCrop() {
        if (!filaCrop.length) { renderPreview(); return; }
        abrirCrop(filaCrop[0]);
    }

    inputImagens?.addEventListener('change', () => {
        const files = Array.from(inputImagens.files || []).slice(0, 10);
        imagensCortadasFiles = [];
        filaCrop = [...files];
        totalFilaCrop = files.length;
        processarFilaCrop();
    });

    $('btnAplicarCropProduto')?.addEventListener('click', () => {
        if (!cropperProduto) return;
        cropperProduto.getCroppedCanvas({ maxWidth: 1200, maxHeight: 1200 }).toBlob(blob => {
            if (!blob) return;
            const nome = arquivoAtualCrop?.name || 'foto.jpg';
            imagensCortadasFiles.push(new File([blob], nome, { type: 'image/jpeg' }));
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
        fd.append('descricao',    $('descricao')?.value.trim() || '');
        fd.append('status',       $('status')?.value || 'ATIVO');
        fd.append('estoque',      $('estoque')?.value || '0');
        fd.append('tipo_oferta',  tipoAtivo);
        fd.append('status_fluxo', statusFluxo);
        fd.append('destino_final',destinoAtivo);
        fd.append('precificado',  $('precificado')?.value || 'false');

        // Campos financeiros
        const financ = ['custo_producao','preco_repasse','preco_venda','quantidade_produzida',
            'unidade_precificacao','peso_gramas','valor_kg_material','maquina_id','tempo_maquina_horas',
            'valor_hora_maquina','custo_energia','custo_mao_obra','custo_embalagem','custo_acessorios',
            'custo_perdas','custo_extra','margem_percentual','canal_venda','taxa_canal_percentual',
            'taxa_canal_fixa','lead_time_dias','qtd_minima','horas_estimadas','valor_hora',
            'tipo_cobranca','subtipo_projeto'];
        financ.forEach(id => { if ($(id)) fd.append(id, $(id).value); });

        // Imagens
        imagensCortadasFiles.forEach(f => fd.append('imagens', f));

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
    async function carregarEdicao(id) {
        editandoId = id;
        $('tituloPagina').textContent   = 'Editar Produto';
        $('subtituloPagina').textContent = 'Atualize as informações do produto.';
        $('lblSalvar').textContent      = 'Atualizar produto';
        try {
            const lista = await App.api('/produtos');
            const p = lista.find(x => String(x.id) === String(id));
            if (!p) return;

            tipoAtivo    = p.tipo_oferta || 'PRODUTO_PROPRIO';
            destinoAtivo = p.destino_final || 'ESTOQUE';
            statusFluxo  = p.status_fluxo || 'ATIVO';

            $('tipo_oferta').value   = tipoAtivo;
            $('destino_final').value = destinoAtivo;
            $('status_fluxo').value  = statusFluxo;
            $('produtoId').value     = id;
            $('nome').value          = p.nome || '';
            $('categoria').value     = p.categoria || '';
            $('variacao').value      = p.variacao || '';
            $('sku').value           = p.sku || '';
            $('descricao').value     = p.descricao || '';

            // Pula o passo 1 (já tem tipo) — vai para passo 2
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
