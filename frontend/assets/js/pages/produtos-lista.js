document.addEventListener('DOMContentLoaded', () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('produtos-lista');

    let produtos = [];
    const tabela = document.getElementById('tabelaProdutos');
    const busca = document.getElementById('buscaProduto');
    const erroBox = document.getElementById('erroProdutos');

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
                <td>${App.money(p.preco_venda)}</td>
                <td>${App.money(p.preco_repasse)}</td>
                <td>${App.money(p.custo_producao)}</td>
                <td><strong>${App.number(p.estoque_central)}</strong></td>
                <td>${App.badgeStatus(p.status)}</td>
                <td><div class="actions"><a class="icon-btn" href="produtos-cadastro.html?id=${p.id}" title="Editar"><i class="bx bx-edit"></i></a><button class="icon-btn" data-del="${p.id}" title="Excluir"><i class="bx bx-trash"></i></button></div></td>
            </tr>`;
        }).join('');
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
        if (!delId) return;
        const ok = await App.confirmDialog({ title: 'Excluir produto?', text: 'Vendas, remessas e consignações ligadas a ele podem ser impactadas.', confirmText: 'Excluir' });
        if (!ok.isConfirmed) return;
        try {
            await App.api(`/produtos/${delId}`, { method: 'DELETE' });
            App.toast('success', 'Produto removido.');
            await carregar();
        } catch (err) { App.toast('error', err.message); }
    });

    busca.addEventListener('input', () => {
        const q = busca.value.toLowerCase().trim();
        render(produtos.filter(p => [p.nome, p.categoria, p.variacao, p.sku].join(' ').toLowerCase().includes(q)));
    });

    carregar();
});
