(() => {
    const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
    const money = (v) => fmt.format(Number(v || 0));
    const api = async (path, options = {}) => {
        const res = await fetch(path, options);
        const text = await res.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch { data = { mensagem: text }; }
        if (!res.ok) throw new Error(data.erro || 'Erro ao carregar catálogo.');
        return data;
    };

    let produtos = [];
    let loja = {};
    let slug = '';
    let carrinho = [];
    let bannerTimer = null;
    let bannerIndex = 0;
    let categoriaAtiva = 'TODOS';
    const galeriasEstado = new Map();

    function pegarSlug() {
        const path = location.pathname.split('/').filter(Boolean);
        if (path[0] === 'catalogo' && path[1]) return path[1];
        const params = new URLSearchParams(location.search);
        return params.get('loja') || 'personalize';
    }

    function imagensProduto(p) {
        const imgs = Array.isArray(p.imagens) ? p.imagens.filter(Boolean) : [];
        if (p.imagem_url && !imgs.includes(p.imagem_url)) imgs.unshift(p.imagem_url);
        return imgs.length ? imgs : [];
    }

    function bannersAtivos() {
        const width = window.innerWidth;
        const tipo = width <= 560 ? 'mobile' : width <= 980 ? 'tablet' : 'desktop';
        const arr = [1,2,3].map(n => loja[`banner_${tipo}_${n}_url`]).filter(Boolean);
        if (arr.length) return arr;
        return [loja.banner_desktop_1_url || loja.banner_desktop_url || loja.banner_url, loja.banner_desktop_2_url, loja.banner_desktop_3_url].filter(Boolean);
    }

    // Garante que só URLs http/https entram no CSS — evita CSS injection
    function urlImgSegura(url) {
        if (!url || typeof url !== 'string') return '';
        const u = url.trim();
        return (u.startsWith('https://') || u.startsWith('http://')) ? u.replace(/'/g, '%27') : '';
    }

    function aplicarBanner() {
        const banners = bannersAtivos();
        const layer = document.getElementById('bannerLayer');
        if (!layer) return;
        if (!banners.length) { layer.style.backgroundImage = ''; return; }
        bannerIndex = bannerIndex % banners.length;
        const safe = urlImgSegura(banners[bannerIndex]);
        layer.style.backgroundImage = safe ? `url('${safe}')` : '';
    }

    function iniciarBanners() {
        clearInterval(bannerTimer);
        aplicarBanner();
        bannerTimer = setInterval(() => {
            const b = bannersAtivos();
            if (b.length > 1) { bannerIndex = (bannerIndex + 1) % b.length; aplicarBanner(); }
        }, 15000);
    }

    function renderGallery(p) {
        const imgs = imagensProduto(p);
        const key = `${p.id}-${p.variacao_id}`;
        const idx = galeriasEstado.get(key) || 0;
        if (!imgs.length) return '<div class="catalogo-gallery"><div class="img-placeholder" style="width:100%;height:100%;">Sem foto</div></div>';
        const nav = imgs.length > 1 ? `
            <button class="gallery-nav prev" onclick="moverFoto('${key}', -1)"><i class="bx bx-chevron-left"></i></button>
            <button class="gallery-nav next" onclick="moverFoto('${key}', 1)"><i class="bx bx-chevron-right"></i></button>` : '';
        return `<div class="catalogo-gallery" data-gallery="${key}">
            <img src="${esc(imgs[idx])}" alt="${esc(p.nome)}">
            ${nav}
            <button class="gallery-zoom" onclick="abrirZoom('${key}')"><i class="bx bx-search-alt-2"></i></button>
        </div>`;
    }

    window.moverFoto = (key, delta) => {
        const prod = produtos.find(p => `${p.id}-${p.variacao_id}` === key);
        if (!prod) return;
        const imgs = imagensProduto(prod);
        const atual = galeriasEstado.get(key) || 0;
        galeriasEstado.set(key, (atual + delta + imgs.length) % imgs.length);
        renderProdutos();
    };

    window.abrirZoom = (key) => {
        const prod = produtos.find(p => `${p.id}-${p.variacao_id}` === key);
        if (!prod) return;
        const imgs = imagensProduto(prod);
        let idx = galeriasEstado.get(key) || 0;
        const overlay = document.createElement('div');
        overlay.className = 'catalogo-modal-zoom';
        const render = () => {
            overlay.innerHTML = `
                <button class="btn btn-light zoom-close"><i class="bx bx-x"></i> Fechar</button>
                ${imgs.length > 1 ? '<button class="gallery-nav prev"><i class="bx bx-chevron-left"></i></button>' : ''}
                <img src="${esc(imgs[idx])}" alt="${esc(prod.nome)}">
                ${imgs.length > 1 ? '<button class="gallery-nav next"><i class="bx bx-chevron-right"></i></button>' : ''}
            `;
            overlay.querySelector('.zoom-close').onclick = () => overlay.remove();
            overlay.querySelector('.prev')?.addEventListener('click', () => { idx = (idx - 1 + imgs.length) % imgs.length; galeriasEstado.set(key, idx); render(); });
            overlay.querySelector('.next')?.addEventListener('click', () => { idx = (idx + 1) % imgs.length; galeriasEstado.set(key, idx); render(); });
        };
        render();
        document.body.appendChild(overlay);
    };


    function categoriaProduto(p) {
        return String(p.categoria || 'Produtos').trim() || 'Produtos';
    }

    function renderCategorias() {
        const el = document.getElementById('catalogoCategorias');
        if (!el) return;
        const cats = Array.from(new Set(produtos.map(categoriaProduto))).sort((a,b)=>a.localeCompare(b,'pt-BR'));
        const botoes = ['TODOS', ...cats];
        el.innerHTML = botoes.map(cat => `<button type="button" class="catalogo-chip ${categoriaAtiva === cat ? 'active' : ''}" data-categoria="${esc(cat)}">${cat === 'TODOS' ? 'Todos' : esc(cat)}</button>`).join('');
        el.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
            categoriaAtiva = btn.dataset.categoria || 'TODOS';
            renderCategorias();
            renderProdutos();
        }));
    }

    function renderTopbar() {
        const nome = loja.nome_loja || 'PERSONALIZE';
        const topNome = document.getElementById('topbarNome');
        const topLogo = document.getElementById('topbarLogo');
        if (topNome) topNome.textContent = nome;
        if (topLogo && loja.logo_url) { topLogo.src = loja.logo_url; topLogo.style.display = 'block'; }
        const whats = whatsappDestino();
        const topWhats = document.getElementById('topbarWhatsapp');
        if (topWhats) {
            if (whats) {
                topWhats.href = `https://wa.me/55${whats}?text=${encodeURIComponent('Olá! Vim pelo catálogo ' + nome + ' e gostaria de atendimento.')}`;
                topWhats.style.display = '';
            } else topWhats.style.display = 'none';
        }
    }

    function renderProdutos() {
        const termoInline  = (document.getElementById('catSearchInline')?.value || '').toLowerCase();
        const termoFloat   = (document.getElementById('floatingSearchInput')?.value || '').toLowerCase();
        const termo = termoInline || termoFloat;
        const grid  = document.getElementById('catalogoGrid');
        const count = document.getElementById('catCount');
        const filtrados = produtos.filter(p => {
            const busca = `${p.nome} ${p.descricao} ${p.categoria}`.toLowerCase().includes(termo);
            const catOk = categoriaAtiva === 'TODOS' || categoriaProduto(p) === categoriaAtiva;
            return busca && catOk;
        });
        if (count) count.textContent = filtrados.length
            ? `${filtrados.length} produto${filtrados.length !== 1 ? 's' : ''}`
            : '';
        if (!filtrados.length) {
            grid.innerHTML = `
                <div style="grid-column:1/-1; text-align:center; padding:48px 20px; color:var(--muted);">
                    <i class='bx bx-search-alt' style="font-size:44px; display:block; margin-bottom:12px; opacity:.4;"></i>
                    <p style="font-weight:600;">Nenhum produto encontrado.</p>
                </div>`;
            return;
        }
        grid.innerHTML = filtrados.map(p => {
            const originLabel = p.origem_publica === 'PERSONALIZE' ? 'PERSONALIZE' : 'Produto da loja';
            const originClass = p.origem_publica === 'PERSONALIZE' ? '' : 'store';
            const gallery     = renderGallery(p);
            return `
            <article class="cat-card">
                <div class="cat-card-media">
                    ${gallery}
                    <div class="cat-card-badges">
                        <span class="cat-badge-origin ${originClass}">${originLabel}</span>
                        ${p.produto_destaque ? '<span class="cat-badge-star"><i class="bx bxs-star"></i> Destaque</span>' : ''}
                    </div>
                </div>
                <div class="cat-card-body">
                    <h3 class="cat-card-name">${esc(p.nome)}</h3>
                    <p class="cat-card-desc">${esc(p.descricao || '')}</p>
                    <div class="cat-card-bottom">
                        <span class="cat-card-price">${money(p.preco_publico)}</span>
                        <button class="cat-btn-add" onclick="adicionarItem(${p.id}, ${p.variacao_id})">
                            <i class="bx bx-cart-add"></i> Adicionar
                        </button>
                    </div>
                </div>
            </article>`;
        }).join('');
    }

    window.adicionarItem = (produtoId, variacaoId) => {
        const prod = produtos.find(p => Number(p.id) === Number(produtoId) && Number(p.variacao_id) === Number(variacaoId));
        if (!prod) return;
        const key = `${produtoId}-${variacaoId}`;
        const existente = carrinho.find(i => i.key === key);
        if (existente) existente.quantidade += 1;
        else carrinho.push({ key, produto_id: produtoId, variacao_id: variacaoId, nome: prod.nome, variacao: prod.variacao, preco: Number(prod.preco_publico || 0), quantidade: 1 });
        renderCarrinho();
        abrirCarrinho();
    };

    function renderCarrinho() {
        const lista = document.getElementById('listaPedido');
        const count = document.getElementById('cartCount');
        const inside = document.getElementById('cartBadgeInside');
        const totalQtd = carrinho.reduce((s, i) => s + i.quantidade, 0);
        if (count) count.textContent = totalQtd;
        if (inside) inside.textContent = totalQtd;
        const topCount = document.getElementById('topbarCartCount');
        if (topCount) topCount.textContent = totalQtd;
        if (!carrinho.length) {
            lista.innerHTML = '<p style="text-align:center; padding:20px; color:#666;">Sua sacola está vazia.</p>';
            document.getElementById('subtotalPedido').textContent = money(0);
            document.getElementById('cartTotal').textContent = money(0);
            return;
        }
        lista.innerHTML = carrinho.map((i, idx) => {
            const produto = produtos.find(p => Number(p.id) === Number(i.produto_id) && Number(p.variacao_id) === Number(i.variacao_id));
            const imagem = imagensProduto(produto || {})[0] || '';
            return `<div class="cart-item">
                ${imagem ? `<img src="${esc(imagem)}" alt="${esc(i.nome)}">` : `<div class="cart-img-placeholder"><i class='bx bx-image'></i></div>`}
                <div class="cart-item-info">
                    <div class="cart-item-title">${esc(i.nome)}</div>
                    <div class="cart-item-price">${esc(i.variacao || '')} • ${money(i.preco)}</div>
                    <div class="cart-qty-box">
                        <button class="cart-qty-btn" onclick="alterarQtd(${idx}, ${i.quantidade - 1})" type="button">-</button>
                        <span class="cart-qty-val">${i.quantidade}</span>
                        <button class="cart-qty-btn" onclick="alterarQtd(${idx}, ${i.quantidade + 1})" type="button">+</button>
                        <button class="cart-remove-inline" onclick="removerItem(${idx})" type="button"><i class='bx bx-trash'></i></button>
                    </div>
                </div>
            </div>`;
        }).join('');
        const subtotal = carrinho.reduce((s, i) => s + (i.preco * i.quantidade), 0);
        document.getElementById('subtotalPedido').textContent = money(subtotal);
        document.getElementById('cartTotal').textContent = money(subtotal);
    }

    window.alterarQtd = (idx, qtd) => { carrinho[idx].quantidade = Math.max(1, Number(qtd || 1)); renderCarrinho(); };
    window.removerItem = (idx) => { carrinho.splice(idx, 1); renderCarrinho(); };

    function abrirCarrinho() { document.getElementById('cartSidebar').classList.add('active'); document.getElementById('cartOverlay').classList.add('active'); renderCarrinho(); }
    function fecharCarrinho() { document.getElementById('cartSidebar').classList.remove('active'); document.getElementById('cartOverlay').classList.remove('active'); }
    function abrirBusca() { document.getElementById('floatingSearch').classList.add('active'); document.getElementById('floatingSearchInput').focus(); }
    function fecharBusca() { document.getElementById('floatingSearch').classList.remove('active'); }

    function whatsappDestino() {
        const candidatos = [loja.whatsapp_catalogo, loja.telefone, loja.footer_contato];
        for (const valor of candidatos) {
            const w = String(valor || '').replace(/\D/g, '');
            if (w.length >= 10) return w;
        }
        return '';
    }

    async function finalizarPedido() {
        if (!carrinho.length) return Swal.fire('Pedido vazio', 'Adicione pelo menos um produto.', 'warning');
        const cliente_nome = document.getElementById('cartNomeCliente').value.trim();
        const cliente_whatsapp = document.getElementById('cartTelefoneCliente').value.trim();
        const cliente_email = document.getElementById('cartEmailCliente').value.trim();
        const observacao = document.getElementById('cartObservacaoCliente').value.trim();
        if (!cliente_nome || !cliente_whatsapp) return Swal.fire('Dados obrigatórios', 'Preencha seu nome e WhatsApp.', 'warning');
        const payload = {
            cliente_nome,
            cliente_whatsapp,
            cliente_email,
            observacao,
            itens: carrinho.map(i => ({ produto_id: i.produto_id, variacao_id: i.variacao_id, quantidade: i.quantidade }))
        };
        const salvo = await api(`/api/catalogo-publico/${slug}/leads`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const whats = String(salvo.whatsapp_destino || whatsappDestino()).replace(/\D/g, '');
        if (whats) {
            const linhas = carrinho.map(i => `- ${i.quantidade}x ${i.nome}`).join('\n');
            const total = carrinho.reduce((s, i) => s + (i.preco * i.quantidade), 0);
            const msg = encodeURIComponent(`Olá! Tenho interesse nos produtos:\n${linhas}\n\nSubtotal: ${money(total)}\nVi pelo catálogo ${loja.nome_loja || 'da loja'}.`);
            window.open(`https://wa.me/55${whats}?text=${msg}`, '_blank');
        }
        carrinho = []; renderCarrinho(); fecharCarrinho();
        document.getElementById('cartNomeCliente').value = '';
        document.getElementById('cartTelefoneCliente').value = '';
        document.getElementById('cartEmailCliente').value = '';
        document.getElementById('cartObservacaoCliente').value = '';
        await Swal.fire('Pedido enviado', 'A loja recebeu seu pedido e poderá entrar em contato.', 'success');
    }

    async function enviarPersonalizado(e) {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
            const salvo = await api(`/api/catalogo-publico/${slug}/cotacoes`, { method: 'POST', body: fd });
            const whats = String(salvo.whatsapp_destino || whatsappDestino()).replace(/\D/g, '');
            if (whats) {
                const msg = encodeURIComponent(`Olá! Enviei uma solicitação de produto personalizado pelo catálogo ${loja.nome_loja || ''}. Código: ${salvo.codigo || ''}`);
                window.open(`https://wa.me/55${whats}?text=${msg}`, '_blank');
            }
            e.target.reset();
            await Swal.fire('Solicitação enviada', 'A loja recebeu seu pedido personalizado.', 'success');
        } catch (err) { Swal.fire('Erro', err.message, 'error'); }
    }


    async function enviarLeadFooter(e) {
        e.preventDefault();
        const form = e.target;
        const nome = form.querySelector('[name="cliente_nome"]')?.value.trim();
        const contato = form.querySelector('[name="cliente_whatsapp"]')?.value.trim();
        const email = form.querySelector('[name="cliente_email"]')?.value.trim();
        const mensagem = form.querySelector('[name="mensagem"]')?.value.trim();
        if (!nome || !contato) return Swal.fire('Dados obrigatórios', 'Preencha seu nome e WhatsApp.', 'warning');
        try {
            const salvo = await api(`/api/catalogo-publico/${slug}/footer-leads`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cliente_nome: nome,
                    cliente_whatsapp: contato,
                    cliente_email: email,
                    observacao: mensagem,
                    origem_lead: 'FOOTER'
                })
            });
            const whats = String(salvo.whatsapp_destino || whatsappDestino()).replace(/\D/g, '');
            if (whats) {
                const msg = encodeURIComponent(`Olá! Entrei em contato pelo catálogo ${loja.nome_loja || ''}.\nNome: ${nome}\nWhatsApp: ${contato}\nMensagem: ${mensagem || 'Gostaria de mais informações.'}`);
                window.open(`https://wa.me/55${whats}?text=${msg}`, '_blank');
            }
            form.reset();
            await Swal.fire('Contato enviado', 'A loja recebeu seu contato nos leads do sistema.', 'success');
        } catch (err) { Swal.fire('Erro', err.message, 'error'); }
    }

    function renderFooter() {
        const el = document.getElementById('catalogoFooter');
        const whats = whatsappDestino();
        const insta = loja.instagram_catalogo ? String(loja.instagram_catalogo).replace('@','') : '';
        const logo = loja.logo_url ? `<img src="${esc(loja.logo_url)}" class="footer-logo" alt="${esc(loja.nome_loja || 'Catálogo')}">` : `<div class="footer-logo footer-logo-fallback"><i class='bx bx-store'></i></div>`;
        el.innerHTML = `
            <div class="footer-top">
                ${logo}
                <p class="footer-text">${esc(loja.descricao_catalogo || 'Produtos personalizados, atendimento direto e soluções sob medida.')}</p>
                <form id="footerLeadForm" class="footer-lead-form">
                    <input name="cliente_nome" placeholder="Seu nome" required>
                    <input name="cliente_whatsapp" placeholder="WhatsApp" required>
                    <input name="cliente_email" placeholder="E-mail opcional">
                    <textarea name="mensagem" placeholder="Como podemos ajudar?"></textarea>
                    <button class="btn-send" type="submit"><i class='bx bx-send'></i> Enviar contato</button>
                </form>
            </div>
            <div class="footer-divider"></div>
            <div class="footer-content">
                <div class="footer-col">
                    <h4>Contato</h4>
                    <p>${esc(loja.footer_contato || loja.whatsapp_catalogo || loja.telefone || 'Entre em contato pelo WhatsApp')}</p>
                    ${whats ? `<p><a href="https://wa.me/55${whats}" target="_blank"><i class='bx bxl-whatsapp'></i> WhatsApp</a></p>` : ''}
                    ${loja.instagram_catalogo ? `<p><a href="https://instagram.com/${esc(insta)}" target="_blank"><i class='bx bxl-instagram'></i> Instagram</a></p>` : ''}
                </div>
                <div class="footer-col center">
                    <h3>${esc(loja.nome_loja || 'PERSONALIZE')}</h3>
                    <p>${esc(loja.footer_copyright || `© ${new Date().getFullYear()} ${loja.nome_loja || 'PERSONALIZE'} - Todos os direitos reservados`)}</p>
                    <div class="social">
                        ${insta ? `<a href="https://instagram.com/${esc(insta)}" target="_blank"><i class='bx bxl-instagram'></i></a>` : ''}
                        ${whats ? `<a href="https://wa.me/55${whats}" target="_blank"><i class='bx bxl-whatsapp'></i></a>` : ''}
                    </div>
                </div>
                <div class="footer-col center">
                    <h4>Localização</h4>
                    <p>${esc(loja.footer_localizacao || 'Consulte a loja para retirada, entrega ou envio.')}</p>
                    <h4 class="mt-space">Atendimento</h4>
                    <a href="#catalogoGrid">Produtos</a>
                    <a href="#formPedidoPersonalizado">Produto personalizado</a>
                </div>
                <div class="footer-col center">
                    <h4>Formas de pagamento</h4>
                    <div class="payment-text">${esc(loja.footer_pagamentos || 'Pix, dinheiro, cartão e condições combinadas com a loja.')}</div>
                    <div class="payment-grid textual">
                        <span>Pix</span><span>Cartão</span><span>Dinheiro</span><span>Boleto</span>
                    </div>
                </div>
            </div>
            <div class="footer-bottom"></div>
            <p class="footer-copy">${esc(loja.footer_copyright || `© ${new Date().getFullYear()} ${loja.nome_loja || 'PERSONALIZE'} - Todos os direitos reservados`)}</p>
        `;
        document.getElementById('footerLeadForm')?.addEventListener('submit', enviarLeadFooter);
    }

    async function carregar() {
        slug = pegarSlug();
        const data = await api(`/api/catalogo-publico/${slug}`);
        loja = data.loja || {}; produtos = data.produtos || [];
        document.getElementById('nomeLoja').textContent = loja.nome_loja || 'PERSONALIZE';
        document.getElementById('descricaoLoja').textContent = loja.descricao_catalogo || 'Catálogo de produtos personalizados.';
        if (loja.logo_url) { document.getElementById('logoLoja').src = loja.logo_url; document.getElementById('logoLoja').style.display = 'block'; }
        document.body.style.setProperty('--catalogo-title-color', loja.cor_titulo || loja.cor_tema || '#2563eb');
        document.body.style.setProperty('--catalogo-price-color', loja.cor_preco || '#16a34a');
        document.body.style.setProperty('--catalogo-button-color', loja.cor_botao || loja.cor_tema || '#2563eb');
        document.body.classList.toggle('catalogo-dark-app', String(loja.tema_catalogo || '').toUpperCase() === 'DARK_PREMIUM');
        const links = [];
        const whats = whatsappDestino();
        if (whats) {
            links.push(`<a class="btn btn-success" target="_blank" href="https://wa.me/55${whats}"><i class="bx bxl-whatsapp"></i> WhatsApp</a>`);
            const wfloat = document.getElementById('whatsappFloat');
            if (wfloat) { wfloat.href = `https://wa.me/55${whats}?text=${encodeURIComponent('Olá! Vim pelo catálogo ' + (loja.nome_loja || '') + ' e gostaria de atendimento.')}`; wfloat.style.display = 'flex'; }
        } else {
            const wfloat = document.getElementById('whatsappFloat');
            if (wfloat) wfloat.style.display = 'none';
        }
        if (loja.instagram_catalogo) links.push(`<a class="btn btn-light" target="_blank" href="https://instagram.com/${esc(String(loja.instagram_catalogo).replace('@',''))}"><i class="bx bxl-instagram"></i> Instagram</a>`);
        document.getElementById('linksContato').innerHTML = links.join('');
        renderTopbar(); renderFooter(); iniciarBanners(); renderCarrinho(); renderCategorias(); renderProdutos();
    }

    document.getElementById('floatingSearchIcon').addEventListener('click', (e) => {
        e.preventDefault();
        const box = document.getElementById('floatingSearch');
        const input = document.getElementById('floatingSearchInput');
        if (!box.classList.contains('active')) abrirBusca();
        else if (!input.value.trim()) fecharBusca();
        else renderProdutos();
    });
    document.getElementById('floatingSearchClose').addEventListener('click', (e) => { e.preventDefault(); document.getElementById('floatingSearchInput').value = ''; renderProdutos(); fecharBusca(); });
    document.getElementById('floatingCartBtn').addEventListener('click', abrirCarrinho);
    document.getElementById('topbarCart')?.addEventListener('click', abrirCarrinho);
    document.getElementById('catalogoMenuToggle')?.addEventListener('click', () => document.getElementById('catalogoNav')?.classList.toggle('active'));
    document.querySelectorAll('#catalogoNav a').forEach(a => a.addEventListener('click', () => document.getElementById('catalogoNav')?.classList.remove('active')));
    document.getElementById('btnCloseCart').addEventListener('click', fecharCarrinho);
    document.getElementById('cartOverlay').addEventListener('click', fecharCarrinho);
    document.addEventListener('click', (e) => {
        const searchBox = document.getElementById('floatingSearch');
        if (searchBox.classList.contains('active') && !searchBox.contains(e.target)) fecharBusca();
        // fecha nav mobile ao clicar fora
        const nav = document.getElementById('catalogoNav');
        const toggle = document.getElementById('catalogoMenuToggle');
        if (nav?.classList.contains('active') && !nav.contains(e.target) && !toggle?.contains(e.target)) nav.classList.remove('active');
    });
    window.addEventListener('resize', aplicarBanner);
    document.getElementById('floatingSearchInput').addEventListener('input', renderProdutos);
    document.getElementById('floatingSearchInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); renderProdutos(); } });
    // busca inline
    document.getElementById('catSearchInline')?.addEventListener('input', renderProdutos);
    document.getElementById('catSearchInline')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); renderProdutos(); } });
    document.getElementById('btnFinalizarPedido').addEventListener('click', () => finalizarPedido().catch(err => Swal.fire('Erro', err.message, 'error')));
    // form personalizado — suporta o novo ID e o antigo
    (document.getElementById('formPedidoPersonalizadoForm') || document.getElementById('formPedidoPersonalizado'))
        ?.addEventListener('submit', enviarPersonalizado);
    carregar().catch(err => { document.getElementById('catalogoGrid').innerHTML = `<div style="grid-column:1/-1;padding:32px;text-align:center;"><p class="text-danger">${esc(err.message)}</p></div>`; });
})();
