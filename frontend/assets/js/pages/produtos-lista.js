document.addEventListener('DOMContentLoaded', () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('produtos-lista');

    let produtos = [];
    const tabela = document.getElementById('tabelaProdutos');
    const busca = document.getElementById('buscaProduto');
    const erroBox = document.getElementById('erroProdutos');

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
        const n = parseMoeda(valor, 0);
        return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function campoPreco(produtoId, campo, valor) {
        return `<input type="text" inputmode="decimal" class="input-cell input-money"
            data-ajuste-preco="${produtoId}" data-campo="${campo}"
            value="${formatarInputMoeda(valor)}" title="Clique para editar e pressione Enter ou saia do campo para salvar">`;
    }

    function campoEstoque(produtoId, valor) {
        return `<input type="number" inputmode="numeric" min="0" step="1" class="input-cell"
            data-ajuste-estoque="${produtoId}"
            value="${App.number(valor || 0).replace(/\./g, '')}" title="Clique para editar e pressione Enter ou saia do campo para salvar">`;
    }

    function galeriaUrls(produto) {
        if (!produto) return [];
        let galeria = produto.galeria;
        if (typeof galeria === 'string') {
            try { galeria = JSON.parse(galeria); } catch { galeria = []; }
        }
        if (!Array.isArray(galeria)) galeria = [];
        const urls = galeria.map(item => typeof item === 'string' ? item : (item?.url || item?.imagem_url)).filter(Boolean);
        if (!urls.length && produto.imagem_url) urls.push(produto.imagem_url);
        return [...new Set(urls)].slice(0, 10);
    }

    function render(lista = produtos) {
        erroBox.classList.add('hidden');
        if (!lista.length) {
            tabela.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhum produto cadastrado.</td></tr>';
            return;
        }
        tabela.innerHTML = lista.map(p => {
            const totalFotos = galeriaUrls(p).length;
            const visivel = p.visivel_catalogo !== false;
            const visBtn = `<button class="icon-btn" data-toggle-visivel="${p.id}" data-visivel="${visivel}"
                title="${visivel ? 'Visível no catálogo digital — clique para ocultar' : 'Oculto do catálogo digital — clique para exibir'}"
                style="color:${visivel ? 'var(--success)' : 'var(--muted)'};">
                <i class="bx ${visivel ? 'bx-show' : 'bx-hide'}"></i>
            </button>`;
            return `
            <tr>
                <td>
                    <div class="product-cell">
                        ${App.imageTag(p.imagem_url)}
                        <div>
                            <strong>${App.escapeHtml(p.nome)}</strong><br>
                            <small>${App.escapeHtml(p.variacao || '')} ${p.sku ? '• SKU ' + App.escapeHtml(p.sku) : ''}</small><br>
                            <small class="text-muted">${totalFotos} foto${totalFotos === 1 ? '' : 's'} ${p.precificado ? '• precificado' : ''}</small>
                        </div>
                    </div>
                </td>
                <td>${App.escapeHtml(p.categoria || '-')}</td>
                <td>${campoPreco(p.id, 'preco_venda', p.preco_venda)}</td>
                <td>${campoPreco(p.id, 'preco_repasse', p.preco_repasse)}</td>
                <td>${campoPreco(p.id, 'custo_producao', p.custo_producao)}</td>
                <td>${campoEstoque(p.id, p.estoque_central)}</td>
                <td>${App.badgeStatus(p.status)}</td>
                <td><div class="actions">${visBtn}<a class="icon-btn" href="produtos-cadastro.html?id=${p.id}" title="Editar"><i class="bx bx-edit"></i></a><button class="icon-btn" data-del="${p.id}" title="Excluir"><i class="bx bx-trash"></i></button></div></td>
            </tr>`;
        }).join('');
    }

    function filtrarLista() {
        const q = busca.value.toLowerCase().trim();
        if (!q) return produtos;
        return produtos.filter(p => [p.nome, p.categoria, p.variacao, p.sku].join(' ').toLowerCase().includes(q));
    }

    async function carregar() {
        try {
            produtos = await App.api('/produtos');
            render();
        } catch (err) {
            console.error(err);
            erroBox.textContent = `${err.message} Verifique se o SQL V3.8 foi rodado no Supabase e se o Render está com as variáveis de ambiente.`;
            erroBox.classList.remove('hidden');
            tabela.innerHTML = '<tr><td colspan="8" class="empty-state">Erro ao carregar produtos.</td></tr>';
            App.toast('error', 'Erro ao buscar produtos.');
        }
    }

    tabela.addEventListener('click', async (e) => {
        const delId = e.target.closest('[data-del]')?.dataset.del;
        const visBtn = e.target.closest('[data-toggle-visivel]');
        if (visBtn) {
            const produtoId = visBtn.dataset.toggleVisivel;
            const novoVisivel = visBtn.dataset.visivel !== 'true';
            try {
                await App.api(`/produtos/${produtoId}/visibilidade`, { method: 'PATCH', body: JSON.stringify({ visivel: novoVisivel }) });
                const p = produtos.find(x => String(x.id) === String(produtoId));
                if (p) p.visivel_catalogo = novoVisivel;
                App.toast('success', novoVisivel ? 'Produto visível no catálogo digital.' : 'Produto oculto do catálogo digital.');
                render(filtrarLista());
            } catch (err) { App.toast('error', err.message); }
            return;
        }
        if (!delId) return;
        const ok = await App.confirmDialog({ title: 'Excluir produto?', text: 'Vendas, remessas e consignações ligadas a ele podem ser impactadas.', confirmText: 'Excluir' });
        if (!ok.isConfirmed) return;
        try {
            await App.api(`/produtos/${delId}`, { method: 'DELETE' });
            App.toast('success', 'Produto removido.');
            await carregar();
        } catch (err) { App.toast('error', err.message); }
    });

    async function salvarAjustePreco(input) {
        const produtoId = input.dataset.ajustePreco;
        const campo = input.dataset.campo;
        const p = produtos.find(x => String(x.id) === String(produtoId));
        if (!p) return;
        const valorAtual = parseMoeda(p[campo], 0);
        const novoValor = parseMoeda(input.value, valorAtual);
        input.value = formatarInputMoeda(novoValor);
        if (Math.round(novoValor * 100) === Math.round(valorAtual * 100)) return;
        try {
            await App.api(`/produtos/${produtoId}/precos`, { method: 'PATCH', body: JSON.stringify({ [campo]: novoValor }) });
            p[campo] = novoValor;
            App.toast('success', 'Valor atualizado.');
        } catch (err) {
            input.value = formatarInputMoeda(valorAtual);
            App.toast('error', err.message);
        }
    }

    async function salvarAjusteEstoque(input) {
        const produtoId = input.dataset.ajusteEstoque;
        const p = produtos.find(x => String(x.id) === String(produtoId));
        if (!p) return;
        const valorAtual = parseInt(p.estoque_central, 10) || 0;
        let novoValor = parseInt(input.value, 10);
        if (!Number.isFinite(novoValor) || novoValor < 0) novoValor = valorAtual;
        input.value = novoValor;
        if (novoValor === valorAtual) return;
        try {
            await App.api(`/produtos/estoque/${produtoId}`, { method: 'PATCH', body: JSON.stringify({ novo_estoque: novoValor }) });
            p.estoque_central = novoValor;
            App.toast('success', 'Estoque atualizado.');
        } catch (err) {
            input.value = valorAtual;
            App.toast('error', err.message);
        }
    }

    tabela.addEventListener('focusout', (e) => {
        const precoInput = e.target.closest('[data-ajuste-preco]');
        if (precoInput) return salvarAjustePreco(precoInput);
        const estoqueInput = e.target.closest('[data-ajuste-estoque]');
        if (estoqueInput) return salvarAjusteEstoque(estoqueInput);
    });

    tabela.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.closest('[data-ajuste-preco], [data-ajuste-estoque]')) {
            e.preventDefault();
            e.target.blur();
        }
    });

    busca.addEventListener('input', () => render(filtrarLista()));

    carregar();
});
