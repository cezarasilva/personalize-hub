document.addEventListener('DOMContentLoaded', () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('produtos-cadastro');

    let produtos = [];
    let editando = null;
    let modoPrecificacao = true;

    const form = document.getElementById('formProduto');
    const inputImagens = document.getElementById('imagens');
    const preview = document.getElementById('previewImagem');
    const blocoPrecificacao = document.getElementById('blocoPrecificacao');
    const inputPrecificado = document.getElementById('precificado');

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

    function moedaNumero(id) { return Number(String(document.getElementById(id)?.value || '0').replace(',', '.')) || 0; }
    function setValor(id, valor) { const el = document.getElementById(id); if (el) el.value = Number(valor || 0).toFixed(2); }

    function destruirCropper() {
        if (cropperProduto) { cropperProduto.destroy(); cropperProduto = null; }
        if (cropObjectUrl) { URL.revokeObjectURL(cropObjectUrl); cropObjectUrl = null; }
        arquivoAtualCrop = null;
    }
    function limparPreviewObjectUrls() { previewObjectUrls.forEach(url => URL.revokeObjectURL(url)); previewObjectUrls = []; }
    function fecharModalCrop({ limparTudo = false } = {}) {
        modalCrop.classList.add('hidden');
        modalCrop.setAttribute('aria-hidden', 'true');
        destruirCropper();
        if (limparTudo) { inputImagens.value = ''; imagensCortadasFiles = []; filaCrop = []; totalFilaCrop = 0; renderPreviewGaleria(); }
    }
    function galeriaUrls(produto) {
        if (!produto) return [];
        let galeria = produto.galeria;
        if (typeof galeria === 'string') { try { galeria = JSON.parse(galeria); } catch { galeria = []; } }
        if (!Array.isArray(galeria)) galeria = [];
        const urls = galeria.map(item => typeof item === 'string' ? item : (item?.url || item?.imagem_url || item?.imagem_url_snapshot || null)).filter(Boolean);
        if (!urls.length && produto.imagem_url) urls.push(produto.imagem_url);
        return [...new Set(urls)].slice(0, 10);
    }
    function renderPreviewGaleria(urlsAtuais = null) {
        limparPreviewObjectUrls();
        let urls = [];
        if (imagensCortadasFiles.length) {
            urls = imagensCortadasFiles.map(file => { const url = URL.createObjectURL(file); previewObjectUrls.push(url); return url; });
        } else if (urlsAtuais) urls = urlsAtuais;
        else if (editando) urls = galeriaUrls(editando);
        if (!urls.length) { preview.innerHTML = 'Sem fotos selecionadas'; preview.className = 'gallery-preview-empty'; return; }
        preview.className = 'gallery-preview-grid';
        preview.innerHTML = urls.slice(0, 10).map((url, index) => `<div class="gallery-preview-item"><img src="${url}" alt="Foto ${index + 1}">${index === 0 ? '<span>Principal</span>' : `<span>${index + 1}</span>`}</div>`).join('');
    }
    function abrirModalCrop(file) {
        destruirCropper();
        arquivoAtualCrop = file;
        cropObjectUrl = URL.createObjectURL(file);
        imagemCrop.src = cropObjectUrl;
        modalCrop.classList.remove('hidden');
        modalCrop.setAttribute('aria-hidden', 'false');
        const atual = imagensCortadasFiles.length + 1;
        cropStatus.textContent = `Recorte a foto ${atual} de ${totalFilaCrop}. A primeira foto será a principal.`;
        setTimeout(() => { cropperProduto = new Cropper(imagemCrop, { aspectRatio: 1, viewMode: 1, autoCropArea: 1, background: false, responsive: true, movable: true, zoomable: true }); }, 80);
    }
    function iniciarProximoCrop() {
        destruirCropper();
        if (!filaCrop.length) { fecharModalCrop({ limparTudo: false }); renderPreviewGaleria(); return; }
        abrirModalCrop(filaCrop.shift());
    }
    inputImagens.addEventListener('change', () => {
        const arquivos = Array.from(inputImagens.files || []);
        if (!arquivos.length) return;
        if (arquivos.length > 10) { App.toast('error', 'Selecione no máximo 10 fotos por produto.'); inputImagens.value = ''; return; }
        if (arquivos.some(file => !file.type.startsWith('image/'))) { App.toast('error', 'Selecione somente imagens.'); inputImagens.value = ''; return; }
        imagensCortadasFiles = [];
        filaCrop = arquivos.slice(0, 10);
        totalFilaCrop = filaCrop.length;
        iniciarProximoCrop();
    });
    btnFecharCrop.addEventListener('click', () => fecharModalCrop({ limparTudo: true }));
    btnCancelarCrop.addEventListener('click', () => fecharModalCrop({ limparTudo: true }));
    modalCrop.addEventListener('click', (e) => { if (e.target === modalCrop) fecharModalCrop({ limparTudo: true }); });
    btnAplicarCrop.addEventListener('click', () => {
        if (!cropperProduto || !arquivoAtualCrop) return;
        const canvas = cropperProduto.getCroppedCanvas({ width: 900, height: 900, imageSmoothingEnabled: true, imageSmoothingQuality: 'high', fillColor: '#ffffff' });
        canvas.toBlob((blob) => {
            if (!blob) { App.toast('error', 'Não foi possível recortar a imagem.'); return; }
            const indice = imagensCortadasFiles.length + 1;
            imagensCortadasFiles.push(new File([blob], `produto_${Date.now()}_${indice}.jpg`, { type: 'image/jpeg' }));
            renderPreviewGaleria();
            iniciarProximoCrop();
        }, 'image/jpeg', 0.92);
    });

    function calcular() {
        const material = (moedaNumero('peso_gramas') / 1000) * moedaNumero('valor_kg_material');
        const maquina = moedaNumero('tempo_maquina_horas') * moedaNumero('valor_hora_maquina');
        const energia = moedaNumero('custo_energia');
        const mao = moedaNumero('custo_mao_obra');
        const embalagem = moedaNumero('custo_embalagem');
        const acessorios = moedaNumero('custo_acessorios');
        const perdas = moedaNumero('custo_perdas');
        const extra = moedaNumero('custo_extra');
        const margem = Math.min(moedaNumero('margem_percentual'), 95);
        const taxaPerc = moedaNumero('taxa_canal_percentual');
        const taxaFixa = moedaNumero('taxa_canal_fixa');
        const custoTotal = material + maquina + energia + mao + embalagem + acessorios + perdas + extra;
        let sugerido = custoTotal;
        if (margem > 0 && margem < 100) sugerido = custoTotal / (1 - (margem / 100));
        if (taxaPerc > 0 && taxaPerc < 100) sugerido = (sugerido + taxaFixa) / (1 - (taxaPerc / 100));
        else sugerido += taxaFixa;
        const repasse = custoTotal > 0 ? Math.max(custoTotal * 1.35, custoTotal + 1) : 0;
        document.getElementById('resMaterial').textContent = App.money(material);
        document.getElementById('resMaquina').textContent = App.money(maquina);
        document.getElementById('resCustoTotal').textContent = App.money(custoTotal);
        document.getElementById('resPrecoSugerido').textContent = App.money(sugerido);
        return { material, maquina, custoTotal, sugerido, repasse };
    }

    document.querySelectorAll('#blocoPrecificacao input, #blocoPrecificacao select').forEach(el => el.addEventListener('input', calcular));
    document.getElementById('btnAplicarPrecificacao').addEventListener('click', () => {
        const r = calcular();
        setValor('custo_producao', r.custoTotal);
        setValor('preco_venda', r.sugerido);
        if (!moedaNumero('preco_repasse')) setValor('preco_repasse', r.repasse);
        App.toast('success', 'Valores calculados aplicados. Você ainda pode editar o preço final.');
    });

    function setModoPrecificacao(valor) {
        modoPrecificacao = valor;
        inputPrecificado.value = valor ? 'true' : 'false';
        blocoPrecificacao.classList.toggle('hidden', !valor);
        document.querySelectorAll('[data-precificar]').forEach(btn => btn.classList.toggle('ativo', (btn.dataset.precificar === 'sim') === valor));
    }
    document.querySelectorAll('[data-precificar]').forEach(btn => btn.addEventListener('click', () => setModoPrecificacao(btn.dataset.precificar === 'sim')));

    async function carregarParaEdicao(id) {
        produtos = await App.api('/produtos');
        const p = produtos.find(x => String(x.id) === String(id));
        if (!p) { App.toast('error', 'Produto não encontrado para edição.'); return; }
        editando = p;
        document.getElementById('produtoId').value = p.id;
        ['nome','categoria','variacao','sku','custo_producao','preco_repasse','preco_venda','estoque','status','descricao'].forEach(idCampo => {
            const el = document.getElementById(idCampo); if (!el) return;
            const key = idCampo === 'estoque' ? 'estoque_central' : idCampo;
            el.value = p[key] ?? '';
        });
        document.getElementById('tituloPaginaProduto').textContent = '✏️ Editar Produto';
        document.getElementById('tituloFormProduto').textContent = `Editando: ${p.nome}`;
        document.getElementById('btnSalvarProduto').textContent = 'Salvar alterações';
        document.getElementById('btnCancelarEdicao').classList.remove('hidden');
        document.getElementById('cardDecisaoPrecificacao').classList.add('hidden');
        setModoPrecificacao(false);
        renderPreviewGaleria(galeriaUrls(p));
    }

    function limparForm() {
        window.location.href = 'produtos-lista.html';
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnSalvarProduto');
        btn.disabled = true;
        const fd = new FormData(form);
        fd.delete('produtoId'); fd.delete('imagens'); fd.delete('imagem');
        fd.set('precificado', modoPrecificacao ? 'true' : 'false');
        if (modoPrecificacao) {
            const r = calcular();
            fd.set('custo_material', r.material.toFixed(2));
            fd.set('custo_maquina', r.maquina.toFixed(2));
            fd.set('custo_total', r.custoTotal.toFixed(2));
            fd.set('preco_sugerido', r.sugerido.toFixed(2));
            fd.set('preco_venda_final', document.getElementById('preco_venda').value || r.sugerido.toFixed(2));
        }
        imagensCortadasFiles.forEach(file => fd.append('imagens', file));
        try {
            const method = editando ? 'PUT' : 'POST';
            const url = editando ? `/produtos/${editando.id}` : '/produtos';
            await App.api(url, { method, body: fd });
            App.toast('success', editando ? 'Produto atualizado.' : 'Produto cadastrado.');
            setTimeout(() => { window.location.href = 'produtos-lista.html'; }, 700);
        } catch (err) { App.toast('error', err.message); }
        finally { btn.disabled = false; }
    });

    document.getElementById('btnCancelarEdicao').addEventListener('click', limparForm);

    const id = new URLSearchParams(window.location.search).get('id');
    if (id) carregarParaEdicao(id).catch(err => App.toast('error', err.message));
    else { setModoPrecificacao(true); calcular(); renderPreviewGaleria([]); }
});
