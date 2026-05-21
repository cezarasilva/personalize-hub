document.addEventListener('DOMContentLoaded', () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('produtos');

    let produtos = [];
    let editando = null;

    const form = document.getElementById('formProduto');
    const tabela = document.getElementById('tabelaProdutos');
    const busca = document.getElementById('buscaProduto');
    const inputImagem = document.getElementById('imagem');
    const preview = document.getElementById('previewImagem');

    const modalCrop = document.getElementById('modalCropProduto');
    const imagemCrop = document.getElementById('imagemCropProduto');
    const btnFecharCrop = document.getElementById('btnFecharCropProduto');
    const btnCancelarCrop = document.getElementById('btnCancelarCropProduto');
    const btnAplicarCrop = document.getElementById('btnAplicarCropProduto');

    let cropperProduto = null;
    let cropObjectUrl = null;
    let imagemCortadaFile = null;

    function destruirCropper() {
        if (cropperProduto) {
            cropperProduto.destroy();
            cropperProduto = null;
        }
        if (cropObjectUrl) {
            URL.revokeObjectURL(cropObjectUrl);
            cropObjectUrl = null;
        }
    }

    function fecharModalCrop({ limparArquivo = false } = {}) {
        modalCrop.classList.add('hidden');
        modalCrop.setAttribute('aria-hidden', 'true');
        destruirCropper();

        if (limparArquivo) {
            inputImagem.value = '';
            imagemCortadaFile = null;
        }
    }

    function abrirModalCrop(file) {
        destruirCropper();
        imagemCortadaFile = null;
        cropObjectUrl = URL.createObjectURL(file);
        imagemCrop.src = cropObjectUrl;
        modalCrop.classList.remove('hidden');
        modalCrop.setAttribute('aria-hidden', 'false');

        setTimeout(() => {
            cropperProduto = new Cropper(imagemCrop, {
                aspectRatio: 1,
                viewMode: 1,
                autoCropArea: 1,
                background: false,
                responsive: true,
                movable: true,
                zoomable: true,
                rotatable: false,
                scalable: false
            });
        }, 80);
    }

    inputImagem.addEventListener('change', () => {
        const file = inputImagem.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            App.toast('error', 'Selecione um arquivo de imagem válido.');
            inputImagem.value = '';
            return;
        }

        abrirModalCrop(file);
    });

    btnFecharCrop.addEventListener('click', () => fecharModalCrop({ limparArquivo: true }));
    btnCancelarCrop.addEventListener('click', () => fecharModalCrop({ limparArquivo: true }));

    modalCrop.addEventListener('click', (e) => {
        if (e.target === modalCrop) fecharModalCrop({ limparArquivo: true });
    });

    btnAplicarCrop.addEventListener('click', () => {
        if (!cropperProduto) return;

        const canvas = cropperProduto.getCroppedCanvas({
            width: 900,
            height: 900,
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high',
            fillColor: '#ffffff'
        });

        canvas.toBlob((blob) => {
            if (!blob) {
                App.toast('error', 'Não foi possível recortar a imagem.');
                return;
            }

            imagemCortadaFile = new File([blob], `produto_${Date.now()}.jpg`, { type: 'image/jpeg' });
            preview.innerHTML = `<img class="product-img-lg" src="${URL.createObjectURL(blob)}" alt="Preview recortado">`;
            preview.className = '';
            fecharModalCrop({ limparArquivo: false });
        }, 'image/jpeg', 0.92);
    });

    function limparForm() {
        editando = null;
        form.reset();
        document.getElementById('produtoId').value = '';
        document.getElementById('tituloFormProduto').textContent = 'Novo produto';
        document.getElementById('btnSalvarProduto').textContent = 'Salvar produto';
        document.getElementById('btnCancelarEdicao').classList.add('hidden');
        preview.innerHTML = 'Sem<br>foto';
        preview.className = 'img-placeholder';
        imagemCortadaFile = null;
        destruirCropper();
    }

    function render(lista = produtos) {
        if (!lista.length) {
            tabela.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhum produto cadastrado.</td></tr>';
            return;
        }
        tabela.innerHTML = lista.map(p => `
            <tr>
                <td><div class="product-cell">${App.imageTag(p.imagem_url)}<div><strong>${App.escapeHtml(p.nome)}</strong><br><small>${App.escapeHtml(p.variacao || '')} ${p.sku ? '• SKU ' + App.escapeHtml(p.sku) : ''}</small></div></div></td>
                <td>${App.escapeHtml(p.categoria || '-')}</td>
                <td>${App.money(p.preco_venda)}</td>
                <td>${App.money(p.preco_repasse)}</td>
                <td>${App.money(p.custo_producao)}</td>
                <td><strong>${App.number(p.estoque_central)}</strong></td>
                <td>${App.badgeStatus(p.status)}</td>
                <td><div class="actions"><button class="icon-btn" data-edit="${p.id}" title="Editar">✏️</button><button class="icon-btn" data-del="${p.id}" title="Excluir">🗑️</button></div></td>
            </tr>`).join('');
    }

    async function carregar() {
        produtos = await App.api('/produtos');
        render();
    }

    tabela.addEventListener('click', async (e) => {
        const editId = e.target.closest('[data-edit]')?.dataset.edit;
        const delId = e.target.closest('[data-del]')?.dataset.del;
        if (editId) {
            const p = produtos.find(x => String(x.id) === String(editId));
            if (!p) return;
            editando = p;
            document.getElementById('produtoId').value = p.id;
            ['nome','categoria','variacao','sku','custo_producao','preco_repasse','preco_venda','estoque','status','descricao'].forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                const key = id === 'estoque' ? 'estoque_central' : id;
                el.value = p[key] ?? '';
            });
            document.getElementById('tituloFormProduto').textContent = `Editando: ${p.nome}`;
            document.getElementById('btnSalvarProduto').textContent = 'Salvar alterações';
            document.getElementById('btnCancelarEdicao').classList.remove('hidden');
            preview.innerHTML = p.imagem_url ? `<img class="product-img-lg" src="${p.imagem_url}" alt="Produto">` : 'Sem<br>foto';
            preview.className = p.imagem_url ? '' : 'img-placeholder';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        if (delId) {
            const ok = await App.confirmDialog({ title: 'Excluir produto?', text: 'Vendas, remessas e consignações ligadas a ele podem ser impactadas.', confirmText: 'Excluir' });
            if (!ok.isConfirmed) return;
            try {
                await App.api(`/produtos/${delId}`, { method: 'DELETE' });
                App.toast('success', 'Produto removido.');
                await carregar();
            } catch (err) { App.toast('error', err.message); }
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnSalvarProduto');
        btn.disabled = true;
        const fd = new FormData(form);
        fd.delete('produtoId');

        const arquivoOriginal = inputImagem.files?.[0];
        fd.delete('imagem');
        if (imagemCortadaFile) {
            fd.append('imagem', imagemCortadaFile);
        } else if (arquivoOriginal) {
            fd.append('imagem', arquivoOriginal);
        }

        try {
            const method = editando ? 'PUT' : 'POST';
            const url = editando ? `/produtos/${editando.id}` : '/produtos';
            await App.api(url, { method, body: fd });
            App.toast('success', editando ? 'Produto atualizado.' : 'Produto cadastrado.');
            limparForm();
            await carregar();
        } catch (err) { App.toast('error', err.message); }
        finally { btn.disabled = false; }
    });

    document.getElementById('btnCancelarEdicao').addEventListener('click', limparForm);
    busca.addEventListener('input', () => {
        const q = busca.value.toLowerCase().trim();
        render(produtos.filter(p => [p.nome, p.categoria, p.variacao, p.sku].join(' ').toLowerCase().includes(q)));
    });

    carregar().catch(err => App.toast('error', err.message));
});
