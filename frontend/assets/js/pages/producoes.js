document.addEventListener('DOMContentLoaded', () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('producoes');

    const form = document.getElementById('formProducao');
    const tbody = document.getElementById('tabelaProducoes');
    const sugestoes = document.getElementById('sugestoesProdutos');
    let produtos = [];
    let maquinas = [];
    let producoes = [];
    let produtoSelecionado = null;

    const el = (id) => document.getElementById(id);
    const val = (id) => el(id)?.value || '';
    const num = (id) => Number(String(val(id)).replace(',', '.')) || 0;
    const set = (id, value) => { if (el(id)) el(id).value = value ?? ''; };

    function hojeLocal() {
        const d = new Date();
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().slice(0, 16);
    }

    function calcular() {
        const peso = num('peso_gramas');
        const valorKg = num('valor_kg_material');
        const tempo = num('tempo_maquina_horas');
        const custoHora = num('custo_hora_maquina');
        const qtd = Math.max(0, parseInt(val('quantidade_produzida'), 10) || 0);
        const material = (peso / 1000) * valorKg;
        const maquina = tempo * custoHora;
        const total = material + maquina + num('custo_energia') + num('custo_mao_obra') + num('custo_embalagem') + num('custo_acessorios') + num('custo_perdas') + num('custo_extra');
        const unitario = qtd > 0 ? total / qtd : 0;
        el('resCustoMaterial').textContent = App.money(material);
        el('resCustoMaquina').textContent = App.money(maquina);
        el('resCustoTotal').textContent = App.money(total);
        el('resCustoUnitario').textContent = App.money(unitario);
        return { material, maquina, total, unitario };
    }

    function selecionarProduto(p) {
        produtoSelecionado = p;
        set('produto_id', p.id);
        set('variacao_id', p.variacao_id);
        set('buscaProduto', `${p.nome} • ${p.variacao || ''}`);
        el('produtoSelecionadoHint').textContent = `Selecionado: ${p.nome} • ${p.variacao || ''} • Estoque atual: ${p.estoque_central || 0}`;
        sugestoes.classList.add('hidden');
    }

    function renderSugestoes() {
        const q = val('buscaProduto').toLowerCase().trim();
        if (!q) { sugestoes.classList.add('hidden'); return; }
        const filtrados = produtos.filter(p => `${p.nome} ${p.variacao || ''} ${p.sku || ''} ${p.categoria || ''}`.toLowerCase().includes(q)).slice(0, 12);
        if (!filtrados.length) {
            sugestoes.innerHTML = '<div class="suggestion-item">Nenhum produto encontrado.</div>';
        } else {
            sugestoes.innerHTML = filtrados.map(p => `
                <div class="suggestion-item" data-id="${p.id}" data-var="${p.variacao_id}">
                    ${App.imageTag(p.imagem_url)}
                    <div><strong>${App.escapeHtml(p.nome)}</strong><br><small>${App.escapeHtml(p.variacao || '')} • SKU: ${App.escapeHtml(p.sku || '-')} • Estoque: ${p.estoque_central || 0}</small></div>
                </div>
            `).join('');
        }
        sugestoes.classList.remove('hidden');
    }

    async function carregarBase() {
        [produtos, maquinas] = await Promise.all([App.api('/produtos'), App.api('/maquinas')]);
        el('maquina_id').innerHTML = '<option value="">Selecione uma máquina...</option>' + maquinas.map(m => `<option value="${m.id}">${App.escapeHtml(m.nome)} • ${App.money(m.custo_total_hora)}/h</option>`).join('');
    }

    function renderTabela() {
        if (!producoes.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhuma produção registrada.</td></tr>';
            return;
        }
        tbody.innerHTML = producoes.map(p => `
            <tr>
                <td><strong>${App.escapeHtml(p.codigo || ('PROD-' + p.id))}</strong></td>
                <td class="product-cell">${App.imageTag(p.imagem_url)}<div><strong>${App.escapeHtml(p.produto_nome || '-')}</strong><br><small>${App.escapeHtml(p.variacao || '')}</small></div></td>
                <td>${App.escapeHtml(p.data_formatada || '')}</td>
                <td><strong>${p.quantidade_produzida || 0}</strong><br><small>Perda: ${p.quantidade_perdida || 0}</small></td>
                <td>${App.escapeHtml(p.maquina_nome || '-')}</td>
                <td><strong>${App.money(p.custo_total)}</strong><br><small>Unit.: ${App.money(p.custo_unitario)}</small></td>
                <td>${App.badgeStatus(p.status)}</td>
                <td class="actions">
                    ${p.status !== 'FINALIZADA' ? `<button class="icon-btn" title="Finalizar e lançar estoque" onclick="finalizarProducao(${p.id})"><i class="bx bx-check-circle"></i></button>` : ''}
                    ${p.status !== 'CANCELADA' ? `<button class="icon-btn" title="Cancelar" onclick="cancelarProducao(${p.id})"><i class="bx bx-x-circle"></i></button>` : ''}
                </td>
            </tr>
        `).join('');
    }

    function renderStats() {
        el('statTotalProducoes').textContent = producoes.length;
        el('statFinalizadas').textContent = producoes.filter(p => p.status === 'FINALIZADA').length;
        el('statUnidades').textContent = producoes.reduce((s, p) => s + Number(p.quantidade_produzida || 0), 0);
        el('statCusto').textContent = App.money(producoes.reduce((s, p) => s + Number(p.custo_total || 0), 0));
    }

    async function carregarProducoes() {
        producoes = await App.api('/producoes');
        renderTabela();
        renderStats();
    }

    window.finalizarProducao = async (id) => {
        const ok = await App.confirmDialog({ title: 'Finalizar produção?', text: 'O estoque central será atualizado com a quantidade produzida.', confirmText: 'Finalizar', icon: 'question' });
        if (!ok.isConfirmed) return;
        try { await App.api(`/producoes/${id}/finalizar`, { method: 'PUT' }); App.toast('success', 'Produção finalizada e estoque lançado.'); carregarProducoes(); } catch (err) { App.toast('error', err.message); }
    };

    window.cancelarProducao = async (id) => {
        const motivo = await Swal.fire({ title: 'Cancelar produção', input: 'textarea', inputLabel: 'Motivo', showCancelButton: true, confirmButtonText: 'Cancelar produção', cancelButtonText: 'Voltar', confirmButtonColor: '#dc2626' });
        if (!motivo.isConfirmed) return;
        try { await App.api(`/producoes/${id}/cancelar`, { method: 'PUT', body: JSON.stringify({ motivo: motivo.value || '' }) }); App.toast('success', 'Produção cancelada.'); carregarProducoes(); } catch (err) { App.toast('error', err.message); }
    };

    el('buscaProduto').addEventListener('input', renderSugestoes);
    sugestoes.addEventListener('click', (e) => {
        const item = e.target.closest('.suggestion-item');
        if (!item) return;
        const p = produtos.find(x => Number(x.id) === Number(item.dataset.id) && Number(x.variacao_id) === Number(item.dataset.var));
        if (p) selecionarProduto(p);
    });

    el('maquina_id').addEventListener('change', () => {
        const m = maquinas.find(x => Number(x.id) === Number(val('maquina_id')));
        if (m) {
            set('custo_hora_maquina', Number(m.custo_total_hora || 0).toFixed(2));
            el('maquinaHint').textContent = `${m.nome}: ${App.money(m.custo_total_hora)}/h (${m.usar_custo_manual ? 'manual' : 'calculado'})`;
        } else {
            el('maquinaHint').textContent = 'Custo/hora será preenchido ao selecionar.';
        }
        calcular();
    });

    document.querySelectorAll('#formProducao input, #formProducao select, #formProducao textarea').forEach(input => input.addEventListener('input', calcular));
    el('btnAtualizarProducoes').addEventListener('click', () => carregarProducoes().catch(err => App.toast('error', err.message)));

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!val('produto_id') || !val('variacao_id')) return App.toast('error', 'Selecione um produto da lista.');
        const calc = calcular();
        const body = {
            produto_id: val('produto_id'),
            variacao_id: val('variacao_id'),
            maquina_id: val('maquina_id') || null,
            status: val('status'),
            data_producao: val('data_producao') || null,
            quantidade_planejada: num('quantidade_planejada'),
            quantidade_produzida: num('quantidade_produzida'),
            quantidade_perdida: num('quantidade_perdida'),
            unidade: val('unidade'),
            peso_gramas: num('peso_gramas'),
            valor_kg_material: num('valor_kg_material'),
            tempo_maquina_horas: num('tempo_maquina_horas'),
            custo_hora_maquina: num('custo_hora_maquina'),
            custo_material: calc.material,
            custo_maquina: calc.maquina,
            custo_energia: num('custo_energia'),
            custo_mao_obra: num('custo_mao_obra'),
            custo_embalagem: num('custo_embalagem'),
            custo_acessorios: num('custo_acessorios'),
            custo_perdas: num('custo_perdas'),
            custo_extra: num('custo_extra'),
            custo_total: calc.total,
            custo_unitario: calc.unitario,
            observacao: val('observacao')
        };
        try {
            await App.api('/producoes', { method: 'POST', body: JSON.stringify(body) });
            App.toast('success', body.status === 'FINALIZADA' ? 'Produção salva e estoque atualizado.' : 'Produção salva.');
            form.reset();
            set('data_producao', hojeLocal()); set('valor_kg_material', 100); set('status', 'FINALIZADA'); set('unidade', 'UNIDADE');
            produtoSelecionado = null; el('produtoSelecionadoHint').textContent = 'Nenhum produto selecionado.'; el('maquinaHint').textContent = 'Custo/hora será preenchido ao selecionar.'; calcular(); carregarProducoes();
        } catch (err) { App.toast('error', err.message); }
    });

    set('data_producao', hojeLocal());
    carregarBase().then(carregarProducoes).then(calcular).catch(err => { tbody.innerHTML = `<tr><td colspan="8">${App.escapeHtml(err.message)}</td></tr>`; });
});
