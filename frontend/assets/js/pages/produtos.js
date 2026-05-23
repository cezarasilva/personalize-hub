document.addEventListener('DOMContentLoaded', () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('produtos');

    let produtos = [];
    let editando = null;

    const form = document.getElementById('formProduto');
    const tabela = document.getElementById('tabelaProdutos');
    const busca = document.getElementById('buscaProduto');
    const inputImagens = document.getElementById('imagens');
    const preview = document.getElementById('previewImagem');

    const modalCrop = document.getElementById('modalCropProduto');
    const imagemCrop = document.getElementById('imagemCropProduto');
    const cropStatus = document.getElementById('cropStatusProduto');
    const btnFecharCrop = document.getElementById('btnFecharCropProduto');
    const btnCancelarCrop = document.getElementById('btnCancelarCropProduto');
    const btnAplicarCrop = document.getElementById('btnAplicarCropProduto');

    let cropperProduto = null;
    let cropObjectUrl = null;
    let arquivoAtualCrop = null;
    let filaCrop = [];
    let totalFilaCrop = 0;
    let imagensCortadasFiles = [];
    let previewObjectUrls = [];

    function destruirCropper() {
        if (cropperProduto) {
            cropperProduto.destroy();
            cropperProduto = null;
        }
        if (cropObjectUrl) {
            URL.revokeObjectURL(cropObjectUrl);
            cropObjectUrl = null;
        }
        arquivoAtualCrop = null;
    }

    function limparPreviewObjectUrls() {
        previewObjectUrls.forEach(url => URL.revokeObjectURL(url));
        previewObjectUrls = [];
    }

    function fecharModalCrop({ limparTudo = false } = {}) {
        modalCrop.classList.add('hidden');
        modalCrop.setAttribute('aria-hidden', 'true');
        destruirCropper();

        if (limparTudo) {
            inputImagens.value = '';
            imagensCortadasFiles = [];
            filaCrop = [];
            totalFilaCrop = 0;
            renderPreviewGaleria();
        }
    }

    function galeriaUrls(produto) {
        if (!produto) return [];
        let galeria = produto.galeria;

        if (typeof galeria === 'string') {
            try { galeria = JSON.parse(galeria); }
            catch (_) { galeria = []; }
        }

        if (!Array.isArray(galeria)) galeria = [];

        const urls = galeria
            .map(item => {
                if (typeof item === 'string') return item;
                return item?.url || item?.imagem_url || item?.imagem_url_snapshot || null;
            })
            .filter(Boolean);

        if (!urls.length && produto.imagem_url) urls.push(produto.imagem_url);

        return [...new Set(urls)].slice(0, 10);
    }

    function renderPreviewGaleria(urlsAtuais = null) {
        limparPreviewObjectUrls();

        let urls = [];
        if (imagensCortadasFiles.length) {
            urls = imagensCortadasFiles.map(file => {
                const url = URL.createObjectURL(file);
                previewObjectUrls.push(url);
                return url;
            });
        } else if (urlsAtuais) {
            urls = urlsAtuais;
        } else if (editando) {
            urls = galeriaUrls(editando);
        }

        if (!urls.length) {
            preview.innerHTML = 'Sem fotos selecionadas';
            preview.className = 'gallery-preview-empty';
            return;
        }

        preview.className = 'gallery-preview-grid';
        preview.innerHTML = urls.slice(0, 10).map((url, index) => `
            <div class="gallery-preview-item">
                <img src="${url}" alt="Foto ${index + 1}">
                ${index === 0 ? '<span>Principal</span>' : `<span>${index + 1}</span>`}
            </div>
        `).join('');
    }

    function abrirModalCrop(file) {
        destruirCropper();
        arquivoAtualCrop = file;
        cropObjectUrl = URL.createObjectURL(file);
        imagemCrop.src = cropObjectUrl;
        modalCrop.classList.remove('hidden');
        modalCrop.setAttribute('aria-hidden', 'false');

        const atual = imagensCortadasFiles.length + 1;
        cropStatus.textContent = `Recorte a foto ${atual} de ${totalFilaCrop}. A primeira foto será a principal do produto.`;

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

    function iniciarProximoCrop() {
        destruirCropper();
        if (!filaCrop.length) {
            fecharModalCrop({ limparTudo: false });
            renderPreviewGaleria();
            return;
        }
        abrirModalCrop(filaCrop.shift());
    }

    inputImagens.addEventListener('change', () => {
        const arquivos = Array.from(inputImagens.files || []);
        if (!arquivos.length) return;

        if (arquivos.length > 10) {
            App.toast('error', 'Selecione no máximo 10 fotos por produto.');
            inputImagens.value = '';
            return;
        }

        const invalidos = arquivos.filter(file => !file.type.startsWith('image/'));
        if (invalidos.length) {
            App.toast('error', 'Selecione somente arquivos de imagem.');
            inputImagens.value = '';
            return;
        }

        imagensCortadasFiles = [];
        filaCrop = arquivos.slice(0, 10);
        totalFilaCrop = filaCrop.length;
        iniciarProximoCrop();
    });

    btnFecharCrop.addEventListener('click', () => fecharModalCrop({ limparTudo: true }));
    btnCancelarCrop.addEventListener('click', () => fecharModalCrop({ limparTudo: true }));

    modalCrop.addEventListener('click', (e) => {
        if (e.target === modalCrop) fecharModalCrop({ limparTudo: true });
    });

    btnAplicarCrop.addEventListener('click', () => {
        if (!cropperProduto || !arquivoAtualCrop) return;

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

            const indice = imagensCortadasFiles.length + 1;
            const file = new File([blob], `produto_${Date.now()}_${indice}.jpg`, { type: 'image/jpeg' });
            imagensCortadasFiles.push(file);
            renderPreviewGaleria();
            iniciarProximoCrop();
        }, 'image/jpeg', 0.92);
    });

    function limparForm() {
        editando = null;
        form.reset();
        document.getElementById('produtoId').value = '';
        document.getElementById('tituloFormProduto').textContent = 'Novo produto';
        document.getElementById('btnSalvarProduto').textContent = 'Salvar produto';
        document.getElementById('btnCancelarEdicao').classList.add('hidden');
        imagensCortadasFiles = [];
        filaCrop = [];
        totalFilaCrop = 0;
        inputImagens.value = '';
        destruirCropper();
        renderPreviewGaleria([]);
    }

    function render(lista = produtos) {
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
                            <small class="text-muted">${totalFotos} foto${totalFotos === 1 ? '' : 's'}</small>
                        </div>
                    </div>
                </td>
                <td>${App.escapeHtml(p.categoria || '-')}</td>
                <td>${App.money(p.preco_venda)}</td>
                <td>${App.money(p.preco_repasse)}</td>
                <td>${App.money(p.custo_producao)}</td>
                <td><strong>${App.number(p.estoque_central)}</strong></td>
                <td>${App.badgeStatus(p.status)}</td>
                <td><div class="actions"><button class="icon-btn" data-edit="${p.id}" title="Editar">✏️</button><button class="icon-btn" data-del="${p.id}" title="Excluir">🗑️</button></div></td>
            </tr>`;
        }).join('');
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
            imagensCortadasFiles = [];
            filaCrop = [];
            inputImagens.value = '';
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
            renderPreviewGaleria(galeriaUrls(p));
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
        fd.delete('imagens');
        fd.delete('imagem');

        if (imagensCortadasFiles.length > 10) {
            App.toast('error', 'O limite é de 10 fotos por produto.');
            btn.disabled = false;
            return;
        }

        imagensCortadasFiles.forEach(file => fd.append('imagens', file));

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
