document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage({ parceiroOnly: true });
    App.renderSidebar('meus-produtos');

    let produtos = [];
    let editando = null;
    const form = document.getElementById('formProdutoLoja');
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

    function destruirCropper() { if (cropperProduto) { cropperProduto.destroy(); cropperProduto = null; } if (cropObjectUrl) { URL.revokeObjectURL(cropObjectUrl); cropObjectUrl = null; } arquivoAtualCrop = null; }
    function limparPreviewObjectUrls() { previewObjectUrls.forEach(url => URL.revokeObjectURL(url)); previewObjectUrls = []; }
    function fecharModalCrop({ limparTudo = false } = {}) { modalCrop.classList.add('hidden'); modalCrop.setAttribute('aria-hidden', 'true'); destruirCropper(); if (limparTudo) { inputImagens.value = ''; imagensCortadasFiles = []; filaCrop = []; totalFilaCrop = 0; renderPreviewGaleria(); } }
    function galeriaUrls(produto) { let galeria = produto?.galeria; if (typeof galeria === 'string') { try { galeria = JSON.parse(galeria); } catch { galeria = []; } } if (!Array.isArray(galeria)) galeria = []; const urls = galeria.map(item => typeof item === 'string' ? item : (item?.url || item?.imagem_url || null)).filter(Boolean); if (!urls.length && produto?.imagem_url) urls.push(produto.imagem_url); return [...new Set(urls)].slice(0, 10); }
    function renderPreviewGaleria(urlsAtuais = null) { limparPreviewObjectUrls(); let urls = []; if (imagensCortadasFiles.length) { urls = imagensCortadasFiles.map(file => { const url = URL.createObjectURL(file); previewObjectUrls.push(url); return url; }); } else if (urlsAtuais) urls = urlsAtuais; else if (editando) urls = galeriaUrls(editando); if (!urls.length) { preview.innerHTML = 'Sem fotos selecionadas'; preview.className = 'gallery-preview-empty mt-2'; return; } preview.className = 'gallery-preview-grid mt-2'; preview.innerHTML = urls.slice(0, 10).map((url, index) => `<div class="gallery-preview-item"><img src="${url}" alt="Foto ${index + 1}">${index === 0 ? '<span>Principal</span>' : `<span>${index + 1}</span>`}</div>`).join(''); }
    function abrirModalCrop(file) { destruirCropper(); arquivoAtualCrop = file; cropObjectUrl = URL.createObjectURL(file); imagemCrop.src = cropObjectUrl; modalCrop.classList.remove('hidden'); modalCrop.setAttribute('aria-hidden', 'false'); cropStatus.textContent = `Recorte a foto ${imagensCortadasFiles.length + 1} de ${totalFilaCrop}.`; setTimeout(() => { cropperProduto = new Cropper(imagemCrop, { aspectRatio: 1, viewMode: 1, autoCropArea: 1, background: false, responsive: true, movable: true, zoomable: true }); }, 80); }
    function iniciarProximoCrop() { destruirCropper(); if (!filaCrop.length) { fecharModalCrop({ limparTudo: false }); renderPreviewGaleria(); return; } abrirModalCrop(filaCrop.shift()); }
    inputImagens.addEventListener('change', () => { const arquivos = Array.from(inputImagens.files || []); if (!arquivos.length) return; if (arquivos.length > 10) { App.toast('error', 'Selecione no máximo 10 fotos.'); inputImagens.value = ''; return; } if (arquivos.some(file => !file.type.startsWith('image/'))) { App.toast('error', 'Selecione somente imagens.'); inputImagens.value = ''; return; } imagensCortadasFiles = []; filaCrop = arquivos.slice(0, 10); totalFilaCrop = filaCrop.length; iniciarProximoCrop(); });
    btnFecharCrop.addEventListener('click', () => fecharModalCrop({ limparTudo: true }));
    btnCancelarCrop.addEventListener('click', () => fecharModalCrop({ limparTudo: true }));
    modalCrop.addEventListener('click', (e) => { if (e.target === modalCrop) fecharModalCrop({ limparTudo: true }); });
    btnAplicarCrop.addEventListener('click', () => { if (!cropperProduto || !arquivoAtualCrop) return; const canvas = cropperProduto.getCroppedCanvas({ width: 900, height: 900, imageSmoothingEnabled: true, imageSmoothingQuality: 'high', fillColor: '#ffffff' }); canvas.toBlob((blob) => { if (!blob) { App.toast('error', 'Não foi possível recortar a imagem.'); return; } imagensCortadasFiles.push(new File([blob], `produto_loja_${Date.now()}_${imagensCortadasFiles.length + 1}.jpg`, { type: 'image/jpeg' })); renderPreviewGaleria(); iniciarProximoCrop(); }, 'image/jpeg', 0.92); });

    function limparForm() { form.reset(); document.getElementById('produtoId').value = ''; editando = null; imagensCortadasFiles = []; renderPreviewGaleria([]); }

    function render() {
        const termo = document.getElementById('busca').value.toLowerCase();
        const lista = document.getElementById('listaProdutos');
        const filtrados = produtos.filter(p => `${p.nome} ${p.categoria} ${p.sku}`.toLowerCase().includes(termo));
        if (!filtrados.length) { lista.innerHTML = '<p class="empty-state">Nenhum produto próprio cadastrado.</p>'; return; }
        lista.innerHTML = filtrados.map(p => {
            const naLixeira = String(p.status || '').toUpperCase() === 'LIXEIRA';
            return `<div class="lead-card ${naLixeira ? 'trash-card' : ''}">
                <div style="display:flex; gap:12px; align-items:center;">
                    ${App.imageTag(p.imagem_url)}
                    <div><strong>${App.escapeHtml(p.nome)}</strong><div class="text-muted">${App.escapeHtml(p.variacao || 'Único')} • ${App.money(p.preco_venda)}</div><div class="mt-1">${App.badgeStatus(p.status)} <span class="owner-chip loja"><i class="bx bx-store"></i> Produto da loja</span></div>${naLixeira ? `<small class="text-danger">Na lixeira até ${p.excluir_permanente_em ? new Date(p.excluir_permanente_em).toLocaleDateString('pt-BR') : '60 dias'}</small>` : ''}</div>
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    ${naLixeira ? `<button class="btn btn-light" onclick="restaurarProdutoLoja(${p.id})"><i class="bx bx-undo"></i></button><button class="btn btn-danger" onclick="excluirPermanenteProdutoLoja(${p.id})"><i class="bx bx-trash-alt"></i></button>` : `<button class="btn btn-light" onclick="editarProdutoLoja(${p.id})"><i class="bx bx-edit"></i></button><button class="btn btn-danger" onclick="removerProdutoLoja(${p.id})"><i class="bx bx-trash"></i></button>`}
                </div>
            </div>`;
        }).join('');
    }

    async function carregar() { produtos = await App.api('/meus-produtos'); render(); }
    window.editarProdutoLoja = (id) => { const p = produtos.find(x => Number(x.id) === Number(id)); if (!p) return; editando = p; document.getElementById('produtoId').value = p.id; ['nome','categoria','variacao','sku','preco_venda','estoque','status','visivel_catalogo','descricao'].forEach(idCampo => { const el = document.getElementById(idCampo); if (!el) return; const key = idCampo === 'estoque' ? 'estoque_central' : idCampo; el.value = p[key] ?? ''; }); renderPreviewGaleria(galeriaUrls(p)); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    window.removerProdutoLoja = async (id) => { const ok = await App.confirmDialog({ title: 'Enviar para lixeira?', text: 'O produto sairá do catálogo e ficará na lixeira por 60 dias.', confirmText: 'Enviar para lixeira' }); if (!ok.isConfirmed) return; await App.api(`/meus-produtos/${id}`, { method: 'DELETE' }); App.toast('success', 'Produto enviado para a lixeira.'); carregar(); };
    window.restaurarProdutoLoja = async (id) => { await App.api(`/meus-produtos/${id}/restaurar`, { method: 'PATCH' }); App.toast('success', 'Produto restaurado.'); carregar(); };
    window.excluirPermanenteProdutoLoja = async (id) => { const ok = await App.confirmDialog({ title: 'Excluir permanentemente?', text: 'Essa ação remove o produto de vez e gera log.', confirmText: 'Excluir definitivamente' }); if (!ok.isConfirmed) return; await App.api(`/meus-produtos/${id}/permanente`, { method: 'DELETE' }); App.toast('success', 'Produto excluído permanentemente.'); carregar(); };

    document.getElementById('busca').addEventListener('input', render);
    form.addEventListener('submit', async (e) => { e.preventDefault(); try { const id = document.getElementById('produtoId').value; const fd = new FormData(e.target); fd.delete('imagens'); imagensCortadasFiles.forEach(file => fd.append('imagens', file)); await App.api(id ? `/meus-produtos/${id}` : '/meus-produtos', { method: id ? 'PUT' : 'POST', body: fd }); App.toast('success', 'Produto salvo.'); limparForm(); await carregar(); } catch (err) { App.toast('error', err.message); } });
    try { renderPreviewGaleria([]); await carregar(); } catch (err) { App.toast('error', err.message); }
});
