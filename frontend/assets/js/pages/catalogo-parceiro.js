document.addEventListener('DOMContentLoaded', () => {
    App.protectPage({ parceiroOnly: true });
    App.renderSidebar('catalogo-parceiro');
    const grid = document.getElementById('cardsProdutos');

    function precoAtual(p) {
        if (p.preco_catalogo_parceiro != null) return Number(p.preco_catalogo_parceiro);
        if (p.dono_tipo === 'PARCEIRO') return Number(p.preco_venda || 0);
        return Number(p.preco_venda || 0);
    }

    function cardPrecificacao(p) {
        const min = Number(p.preco_repasse || 0);
        const atual = precoAtual(p);
        const visivel = p.visivel_parceiro !== false;
        const hint = min > 0
            ? `<small class="text-muted" style="font-size:11px;">Mínimo: ${App.money(min)} (repasse)</small>`
            : '';
        return `
            <div class="form-group mt-2" style="margin-bottom:0">
                <label style="font-size:12px;font-weight:700;color:var(--text-2);">Preço no seu catálogo</label>
                <div style="display:flex;gap:6px;align-items:center;">
                    <input
                        type="number"
                        step="0.01"
                        min="${min > 0 ? min : 0}"
                        value="${atual.toFixed(2)}"
                        class="preco-catalogo-input"
                        data-var="${p.variacao_id}"
                        data-min="${min}"
                        style="flex:1;padding:7px 10px;border-radius:var(--radius-sm);border:1.5px solid var(--border);background:var(--input-bg);color:var(--text);font-size:13px;font-weight:700;"
                    >
                    <button
                        type="button"
                        class="btn btn-primary btn-salvar-preco"
                        data-var="${p.variacao_id}"
                        style="padding:7px 14px;min-height:36px;font-size:12px;"
                    ><i class="bx bx-check"></i></button>
                    <button
                        type="button"
                        class="icon-btn btn-toggle-visivel"
                        data-var="${p.variacao_id}"
                        data-visivel="${visivel}"
                        title="${visivel ? 'Visível no seu catálogo — clique para ocultar' : 'Oculto do seu catálogo — clique para exibir'}"
                        style="min-height:36px;color:${visivel ? 'var(--success)' : 'var(--muted)'};"
                    ><i class="bx ${visivel ? 'bx-show' : 'bx-hide'}"></i></button>
                </div>
                ${hint}
                <small class="visivel-status" data-var="${p.variacao_id}" style="display:block;margin-top:4px;font-size:11px;font-weight:600;color:${visivel ? 'var(--success)' : 'var(--muted)'};">
                    <i class="bx ${visivel ? 'bx-check-circle' : 'bx-x-circle'}"></i> ${visivel ? 'Visível no seu catálogo' : 'Oculto do seu catálogo'}
                </small>
            </div>`;
    }

    async function salvarPreco(variacaoId, preco) {
        try {
            await App.api('/parceiro/catalogo/preco', {
                method: 'PUT',
                body: JSON.stringify({ variacao_id: variacaoId, preco })
            });
            App.toast('success', 'Preço atualizado no catálogo.');
        } catch (err) {
            App.toast('error', err.message);
        }
    }

    function bindPrecificacao() {
        grid.querySelectorAll('.btn-salvar-preco').forEach(btn => {
            btn.addEventListener('click', () => {
                const varId = btn.dataset.var;
                const input = grid.querySelector(`.preco-catalogo-input[data-var="${varId}"]`);
                const min = parseFloat(input.dataset.min || 0);
                const val = parseFloat(input.value || 0);
                if (isNaN(val) || val < 0) return App.toast('error', 'Informe um valor válido.');
                if (min > 0 && val < min) return App.toast('error', `Preço mínimo: ${App.money(min)} (repasse).`);
                salvarPreco(varId, val);
            });
        });
    }

    async function salvarVisibilidade(variacaoId, visivel) {
        await App.api('/parceiro/catalogo/visibilidade', {
            method: 'PUT',
            body: JSON.stringify({ variacao_id: variacaoId, visivel })
        });
    }

    function bindVisibilidade() {
        grid.querySelectorAll('.btn-toggle-visivel').forEach(btn => {
            btn.addEventListener('click', async () => {
                const varId = btn.dataset.var;
                const novoVisivel = btn.dataset.visivel !== 'true';
                btn.disabled = true;
                try {
                    await salvarVisibilidade(varId, novoVisivel);
                    btn.dataset.visivel = String(novoVisivel);
                    btn.title = novoVisivel ? 'Visível no seu catálogo — clique para ocultar' : 'Oculto do seu catálogo — clique para exibir';
                    btn.style.color = novoVisivel ? 'var(--success)' : 'var(--muted)';
                    btn.innerHTML = `<i class="bx ${novoVisivel ? 'bx-show' : 'bx-hide'}"></i>`;
                    const status = grid.querySelector(`.visivel-status[data-var="${varId}"]`);
                    if (status) {
                        status.style.color = novoVisivel ? 'var(--success)' : 'var(--muted)';
                        status.innerHTML = `<i class="bx ${novoVisivel ? 'bx-check-circle' : 'bx-x-circle'}"></i> ${novoVisivel ? 'Visível no seu catálogo' : 'Oculto do seu catálogo'}`;
                    }
                    App.toast('success', novoVisivel ? 'Produto visível no seu catálogo.' : 'Produto oculto do seu catálogo.');
                } catch (err) {
                    App.toast('error', err.message);
                } finally {
                    btn.disabled = false;
                }
            });
        });
    }

    async function carregar() {
        const busca = encodeURIComponent(document.getElementById('busca').value || '');
        const visao = document.getElementById('filtroVisao').value;
        const produtos = await App.api(`/parceiro/catalogo?busca=${busca}`);
        if (!produtos.length) { grid.innerHTML = '<div class="card empty-state">Nenhum produto encontrado.</div>'; return; }

        let filtrados;
        if (visao === 'loja') {
            filtrados = produtos.filter(p => p.quantidade_na_loja > 0);
            if (!filtrados.length) { grid.innerHTML = '<div class="card empty-state">Sua loja não possui produtos em estoque no momento.</div>'; return; }
            grid.innerHTML = filtrados.map(p => `
                <article class="card">
                    <div class="product-cell mb-2">
                        ${App.imageTag(p.imagem_url, 'product-img-lg')}
                        <div>
                            <strong>${App.escapeHtml(p.nome)}</strong><br>
                            <small>${App.escapeHtml(p.variacao || '')} ${p.sku ? '• SKU ' + App.escapeHtml(p.sku) : ''}</small>
                        </div>
                    </div>
                    <p class="text-muted">${App.escapeHtml(p.categoria || '')}</p>
                    <div class="stat-card compact-stat mt-2">
                        <span>Na loja</span><strong>${App.number(p.quantidade_na_loja)}</strong>
                    </div>
                    <p class="mt-2">
                        <strong>Repasse:</strong> ${App.money(p.preco_repasse)}<br>
                        <strong>Venda sugerida:</strong> ${App.money(p.preco_venda)}
                    </p>
                    ${cardPrecificacao(p)}
                    <button class="btn btn-success w-full mt-2" data-id="${p.produto_id}" data-var="${p.variacao_id}" data-nome="${App.escapeHtml(p.nome)}">Solicitar reposição</button>
                </article>`).join('');
        } else {
            filtrados = produtos.filter(p => p.estoque_central > 0);
            if (!filtrados.length) { grid.innerHTML = '<div class="card empty-state">Nenhum produto disponível na central no momento.</div>'; return; }
            grid.innerHTML = filtrados.map(p => `
                <article class="card">
                    <div class="product-cell mb-2">
                        ${App.imageTag(p.imagem_url, 'product-img-lg')}
                        <div>
                            <strong>${App.escapeHtml(p.nome)}</strong><br>
                            <small>${App.escapeHtml(p.variacao || '')} ${p.sku ? '• SKU ' + App.escapeHtml(p.sku) : ''}</small>
                        </div>
                    </div>
                    <p class="text-muted">${App.escapeHtml(p.categoria || '')}</p>
                    <div class="stat-card compact-stat mt-2">
                        <span>Central</span><strong>${App.number(p.estoque_central)}</strong>
                    </div>
                    <p class="mt-2">
                        <strong>Repasse:</strong> ${App.money(p.preco_repasse)}<br>
                        <strong>Venda sugerida:</strong> ${App.money(p.preco_venda)}
                    </p>
                    ${cardPrecificacao(p)}
                    <button class="btn btn-success w-full mt-2" data-id="${p.produto_id}" data-var="${p.variacao_id}" data-nome="${App.escapeHtml(p.nome)}">Solicitar reposição</button>
                </article>`).join('');
        }

        grid.querySelectorAll('button[data-id]').forEach(btn =>
            btn.addEventListener('click', () => solicitar(btn.dataset.id, btn.dataset.var, btn.dataset.nome))
        );
        bindPrecificacao();
        bindVisibilidade();
    }

    async function solicitar(produto_id, variacao_id, nome) {
        const { value } = await Swal.fire({
            title: `Solicitar ${nome}`,
            html: '<input id="qtd" type="number" min="1" class="swal2-input" placeholder="Quantidade" value="5"><textarea id="obs" class="swal2-textarea" placeholder="Observação opcional"></textarea>',
            showCancelButton: true,
            confirmButtonText: 'Enviar solicitação',
            cancelButtonText: 'Cancelar',
            preConfirm: () => ({ quantidade: document.getElementById('qtd').value, observacao: document.getElementById('obs').value })
        });
        if (!value) return;
        await App.api('/solicitacoes-produto', { method: 'POST', body: JSON.stringify({ produto_id, variacao_id, quantidade: value.quantidade, observacao: value.observacao, tipo_solicitacao: 'REPOSICAO' }) });
        App.toast('success', 'Solicitação enviada.');
    }

    document.getElementById('btnBuscar').addEventListener('click', carregar);
    document.getElementById('busca').addEventListener('keydown', e => { if (e.key === 'Enter') carregar(); });
    document.getElementById('filtroVisao').addEventListener('change', carregar);
    carregar().catch(err => App.toast('error', err.message));
});
