document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage();
    App.renderSidebar('meu-catalogo');

    const esc = App.escapeHtml;
    let ultimaConfig = null;

    function itemPreview(url, label) {
        return url ? `<div><img src="${esc(url)}" alt="${esc(label)}"><small class="text-muted">${esc(label)}</small></div>` : `<div><div class="img-placeholder" style="width:100%;height:94px;">Sem<br>${esc(label)}</div><small class="text-muted">${esc(label)}</small></div>`;
    }

    function renderLinkTools(cfg) {
        const link = cfg.link_publico || '';
        const qrUrl = link ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(link)}` : '';
        const tools = document.getElementById('catalogoLinkTools');
        const qr = document.getElementById('catalogoQrBox');
        if (tools) tools.innerHTML = `
            <div class="catalogo-link-card">
                <small>Link público do catálogo</small>
                <strong>${esc(link || 'Link indisponível')}</strong>
                <div class="actions mt-2">
                    <button class="btn btn-light" type="button" id="btnCopiarCatalogo"><i class='bx bx-copy'></i> Copiar link</button>
                    <button class="btn btn-success" type="button" id="btnCompartilharCatalogo"><i class='bx bxl-whatsapp'></i> Compartilhar</button>
                    <a class="btn btn-primary" href="${esc(link || '#')}" target="_blank"><i class='bx bx-link-external'></i> Abrir</a>
                </div>
            </div>`;
        if (qr) qr.innerHTML = qrUrl ? `
            <div class="catalogo-qr-card">
                <img src="${qrUrl}" alt="QR Code do catálogo">
                <a class="btn btn-light" href="${qrUrl}" download="qrcode-catalogo.png" target="_blank"><i class='bx bx-download'></i> Baixar QR Code</a>
            </div>` : '';
        document.getElementById('btnCopiarCatalogo')?.addEventListener('click', async () => { await App.copyText(link); App.toast('success', 'Link copiado.'); });
        document.getElementById('btnCompartilharCatalogo')?.addEventListener('click', () => {
            const msg = encodeURIComponent(`Confira nosso catálogo: ${link}`);
            window.open(`https://wa.me/?text=${msg}`, '_blank');
        });
    }

    function renderPreview(cfg) {
        document.getElementById('previewCatalogo').innerHTML = `
            ${itemPreview(cfg.logo_url, 'Logo')}
            ${itemPreview(cfg.banner_desktop_1_url || cfg.banner_desktop_url || cfg.banner_url, 'PC 1')}
            ${itemPreview(cfg.banner_desktop_2_url, 'PC 2')}
            ${itemPreview(cfg.banner_desktop_3_url, 'PC 3')}
            ${itemPreview(cfg.banner_tablet_1_url || cfg.banner_tablet_url, 'Tablet 1')}
            ${itemPreview(cfg.banner_tablet_2_url, 'Tablet 2')}
            ${itemPreview(cfg.banner_tablet_3_url, 'Tablet 3')}
            ${itemPreview(cfg.banner_mobile_1_url || cfg.banner_mobile_url, 'Mobile 1')}
            ${itemPreview(cfg.banner_mobile_2_url, 'Mobile 2')}
            ${itemPreview(cfg.banner_mobile_3_url, 'Mobile 3')}
        `;
    }

    async function carregar() {
        const cfg = await App.api('/catalogo-config');
        ultimaConfig = cfg;
        const fields = ['slug_catalogo','whatsapp_catalogo','instagram_catalogo','descricao_catalogo','cor_titulo','cor_preco','cor_botao','footer_contato','footer_localizacao','footer_pagamentos','footer_copyright'];
        fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = cfg[id] || (id === 'cor_titulo' ? (cfg.cor_tema || '#2563eb') : id === 'cor_preco' ? '#16a34a' : id === 'cor_botao' ? (cfg.cor_tema || '#2563eb') : ''); });
        document.getElementById('catalogo_ativo').value = cfg.catalogo_ativo === false ? 'false' : 'true';
        const btn = document.getElementById('btnVerCatalogo');
        btn.href = cfg.link_publico || '#';
        renderPreview(cfg);
        renderLinkTools(cfg);
        const fimTeste = cfg.catalogo_teste_fim ? new Date(cfg.catalogo_teste_fim).toLocaleDateString('pt-BR') : 'não definido';
        const status = cfg.catalogo_plano_status || (App.isAdmin() ? 'ADMIN' : 'TESTE_GRATIS');
        document.getElementById('boxAssinatura').innerHTML = `
            <p><strong>Status:</strong> ${App.badgeStatus(status)}</p>
            ${App.isParceiro() ? `<p class="mt-2"><strong>Teste gratuito até:</strong> ${fimTeste}</p>` : ''}
            <p class="mt-2"><strong>Link público:</strong><br><a href="${esc(cfg.link_publico || '#')}" target="_blank">${esc(cfg.link_publico || '')}</a></p>
        `;
    }

    document.getElementById('formCatalogo').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const fd = new FormData(e.target);
            await App.api('/catalogo-config', { method: 'PUT', body: fd });
            App.toast('success', 'Catálogo atualizado.');
            e.target.querySelectorAll('input[type="file"]').forEach(i => i.value = '');
            e.target.querySelectorAll('input[type="checkbox"]').forEach(i => i.checked = false);
            await carregar();
        } catch (err) { App.toast('error', err.message); }
    });

    document.getElementById('btnResetarCatalogo').addEventListener('click', async () => {
        const ok = await App.confirmDialog({ title: 'Resetar logo e banners?', text: 'Isso remove logo e todos os banners cadastrados. Os textos e cores continuam.', confirmText: 'Resetar' });
        if (!ok.isConfirmed) return;
        const fd = new FormData();
        fd.set('resetar', 'true');
        if (ultimaConfig?.slug_catalogo) fd.set('slug_catalogo', ultimaConfig.slug_catalogo);
        await App.api('/catalogo-config', { method: 'PUT', body: fd });
        App.toast('success', 'Logo e banners resetados.');
        await carregar();
    });

    try { await carregar(); } catch (err) { App.toast('error', err.message); }
});
