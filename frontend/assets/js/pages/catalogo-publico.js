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

    const PAGE_SIZE = 12;
    let produtos = [];
    let produtosFiltrados = [];
    let paginaAtual = 1;
    let loja = {};
    let slug = '';
    let carrinho = [];
    let bannerTimer = null;
    let bannerIndex = 0;
    let categoriaAtiva = 'TODOS';
    const galeriasEstado = new Map();
    const stepperLivre = new Map(); // produtoId -> quantidade (produtos sem seletor/faixa)

    // Carrossel de destaques
    let destaques = [];
    let destaqueIndex = 0;
    let destaqueTimer = null;

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
        if (!imgs.length) return '<div class="catalogo-gallery"><div class="img-placeholder"><i class="bx bx-image-alt"></i>Fotos em breve</div></div>';
        const nav = imgs.length > 1
            ? `<button class="gallery-nav next" onclick="event.preventDefault();event.stopPropagation();moverFoto('${key}', 1)"><i class="bx bx-chevron-right"></i></button>`
            : '';
        const dots = imgs.length > 1
            ? `<div class="cat-card-dots">${imgs.map((_, i) => `<span class="${i === idx ? 'active' : ''}"></span>`).join('')}</div>`
            : '';
        return `<div class="catalogo-gallery" data-gallery="${key}">
            <img src="${esc(imgs[idx])}" alt="${esc(p.nome)}">
            ${nav}
            ${dots}
        </div>`;
    }

    // Atualiza só a(s) galeria(s) daquele produto no DOM (pode existir tanto na
    // grade quanto no carrossel de destaques) — evita re-renderizar tudo e
    // resetar a posição/timer do carrossel.
    window.moverFoto = (key, delta) => {
        const prod = produtos.find(p => `${p.id}-${p.variacao_id}` === key);
        if (!prod) return;
        const imgs = imagensProduto(prod);
        const atual = galeriasEstado.get(key) || 0;
        galeriasEstado.set(key, (atual + delta + imgs.length) % imgs.length);
        document.querySelectorAll(`.catalogo-gallery[data-gallery="${key}"]`).forEach(el => {
            el.outerHTML = renderGallery(prod);
        });
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

    // --- Variações / tabela de preço por quantidade ---

    function variacoesDoProduto(p) {
        if (Array.isArray(p.variacoes) && p.variacoes.length) return p.variacoes;
        return [{ variacao_id: p.variacao_id, variacao: p.variacao, preco_publico: p.preco_publico, precos_qtd: [] }];
    }

    function opcoesQtd(variacao) {
        if (Array.isArray(variacao.precos_qtd) && variacao.precos_qtd.length) return variacao.precos_qtd;
        return [{ quantidade: 1, preco_unitario: variacao.preco_publico }];
    }

    function temSeletor(p) {
        const vs = variacoesDoProduto(p);
        return vs.length > 1 || vs.some(v => Array.isArray(v.precos_qtd) && v.precos_qtd.length > 0);
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

    function cardHtml(p) {
        const gallery = renderGallery(p);
        const vs = variacoesDoProduto(p);
        const comSel = temSeletor(p);
        const precoInicial = vs[0].preco_publico;
        const href = `produto-detalhe.html?loja=${esc(slug)}&id=${p.id}&vid=${vs[0].variacao_id}`;

        const seletorHtml = comSel ? `
            <div class="cat-card-seletores" data-pid="${p.id}">
                ${vs.length > 1 ? `
                <select class="cat-sel-tamanho" onchange="window._catSelTamanhoChange(this, ${p.id})">
                    ${vs.map((v, i) => `<option value="${i}">${esc(v.variacao || 'Padrão')}</option>`).join('')}
                </select>` : ''}
                <select class="cat-sel-qtd" onchange="window._catSelQtdChange(this, ${p.id})">
                    ${opcoesQtd(vs[0]).map(f => `<option value="${f.quantidade}" data-preco="${f.preco_unitario}">${f.quantidade} un.</option>`).join('')}
                </select>
            </div>` : '';

        return `
        <article class="cat-card">
            <a class="cat-card-media-link" href="${href}">
                <div class="cat-card-media">
                    ${gallery}
                    ${p.produto_destaque ? '<span class="cat-badge-star"><i class="bx bxs-star"></i> Destaque</span>' : ''}
                </div>
            </a>
            <div class="cat-card-body">
                <div class="cat-card-toprow">
                    <a class="cat-card-name-link" href="${href}"><h3 class="cat-card-name">${esc(p.nome)}</h3></a>
                    <span class="cat-card-price-inline" data-price-for="${p.id}">${money(precoInicial)}</span>
                </div>
                ${p.categoria ? `<p class="cat-card-subtitle">${esc(p.categoria)}</p>` : ''}
                <p class="cat-card-desc">${esc(p.descricao || '')}</p>
                ${seletorHtml}
                <div class="cat-card-bottom">
                    <span class="cat-card-price-pill" data-price-for="${p.id}">${money(precoInicial)}</span>
                    <button class="cat-btn-add" onclick="adicionarItem(${p.id})">
                        Adicionar <i class="bx bx-right-arrow-alt"></i>
                    </button>
                </div>
                ${stepperHtml(p)}
            </div>
        </article>`;
    }

    // Stepper de quantidade — usado só no card mobile (lista horizontal). Para
    // produtos com tabela de preço por quantidade, avança entre as faixas
    // cadastradas (sincronizado com o <select> de quantidade); para produtos
    // simples, é um contador livre a partir de 1.
    function stepperHtml(p) {
        const comSel = temSeletor(p);
        const vs = variacoesDoProduto(p);
        const valor = comSel ? `${opcoesQtd(vs[0])[0]?.quantidade ?? 1} un.` : String(stepperLivre.get(p.id) || 1);
        return `
        <div class="cat-card-stepper" data-pid="${p.id}">
            <button type="button" class="cat-stepper-btn" onclick="window._catStepperMove(${p.id}, -1)" aria-label="Diminuir">−</button>
            <span class="cat-stepper-val" data-stepper-val="${p.id}">${valor}</span>
            <button type="button" class="cat-stepper-btn" onclick="window._catStepperMove(${p.id}, 1)" aria-label="Aumentar">+</button>
            <button type="button" class="cat-btn-add-mobile" onclick="adicionarItem(${p.id})" title="Adicionar ao carrinho">
                <i class="bx bx-cart-add"></i>
            </button>
        </div>`;
    }

    window._catStepperMove = (produtoId, delta) => {
        const prod = produtos.find(p => Number(p.id) === Number(produtoId));
        if (!prod) return;
        const comSel = temSeletor(prod);
        const valEl = document.querySelector(`[data-stepper-val="${produtoId}"]`);

        if (comSel) {
            const card = document.querySelector(`.cat-card-seletores[data-pid="${produtoId}"]`);
            const selQtd = card?.querySelector('.cat-sel-qtd');
            if (!selQtd) return;
            const novoIndex = Math.min(selQtd.options.length - 1, Math.max(0, selQtd.selectedIndex + delta));
            if (novoIndex === selQtd.selectedIndex) return;
            selQtd.selectedIndex = novoIndex;
            selQtd.dispatchEvent(new Event('change'));
            if (valEl) valEl.textContent = `${selQtd.value} un.`;
        } else {
            const atual = stepperLivre.get(produtoId) || 1;
            const novo = Math.max(1, atual + delta);
            stepperLivre.set(produtoId, novo);
            if (valEl) valEl.textContent = String(novo);
        }
    };

    // Troca de tamanho: repopula as opções de quantidade da variação escolhida
    window._catSelTamanhoChange = (selTam, produtoId) => {
        const card = selTam.closest('.cat-card-seletores');
        const prod = produtos.find(p => Number(p.id) === Number(produtoId));
        if (!card || !prod) return;
        const vs = variacoesDoProduto(prod);
        const variacao = vs[Number(selTam.value || 0)] || vs[0];
        const selQtd = card.querySelector('.cat-sel-qtd');
        if (selQtd) {
            selQtd.innerHTML = opcoesQtd(variacao).map(f => `<option value="${f.quantidade}" data-preco="${f.preco_unitario}">${f.quantidade} un.</option>`).join('');
        }
        atualizarPrecoCard(produtoId, variacao.preco_publico);
    };

    window._catSelQtdChange = (selQtd, produtoId) => {
        const preco = selQtd.selectedOptions[0]?.dataset.preco;
        atualizarPrecoCard(produtoId, preco);
    };

    function atualizarPrecoCard(produtoId, preco) {
        document.querySelectorAll(`[data-price-for="${produtoId}"]`).forEach(el => { el.textContent = money(preco); });
    }

    function atualizarVerMais() {
        const wrap = document.getElementById('verMaisWrap');
        if (wrap) wrap.style.display = produtosFiltrados.length > paginaAtual * PAGE_SIZE ? '' : 'none';
    }

    function renderProdutos() {
        const termoInline  = (document.getElementById('catSearchInline')?.value || '').toLowerCase();
        const termoFloat   = (document.getElementById('floatingSearchInput')?.value || '').toLowerCase();
        const termo = termoInline || termoFloat;
        const grid  = document.getElementById('catalogoGrid');
        const count = document.getElementById('catCount');

        produtosFiltrados = produtos.filter(p => {
            const busca = `${p.nome} ${p.descricao} ${p.categoria}`.toLowerCase().includes(termo);
            const catOk = categoriaAtiva === 'TODOS' || categoriaProduto(p) === categoriaAtiva;
            return busca && catOk;
        });
        paginaAtual = 1;

        if (count) count.textContent = produtosFiltrados.length
            ? `${produtosFiltrados.length} produto${produtosFiltrados.length !== 1 ? 's' : ''}`
            : '';
        if (!produtosFiltrados.length) {
            grid.innerHTML = `
                <div style="column-span:all; text-align:center; padding:48px 20px; color:var(--muted);">
                    <i class='bx bx-search-alt' style="font-size:44px; display:block; margin-bottom:12px; opacity:.4;"></i>
                    <p style="font-weight:600;">Nenhum produto encontrado.</p>
                </div>`;
            atualizarVerMais();
            return;
        }
        grid.innerHTML = produtosFiltrados.slice(0, PAGE_SIZE).map(cardHtml).join('');
        atualizarVerMais();
    }

    function carregarMais() {
        const grid = document.getElementById('catalogoGrid');
        if (!grid) return;
        paginaAtual++;
        const inicio = (paginaAtual - 1) * PAGE_SIZE;
        const novos = produtosFiltrados.slice(inicio, paginaAtual * PAGE_SIZE);
        grid.insertAdjacentHTML('beforeend', novos.map(cardHtml).join(''));
        atualizarVerMais();
    }

    // --- Carrossel de destaques (logo abaixo do banner, antes da grade) ---

    function itensVisiveisDestaque() {
        const w = window.innerWidth;
        if (w <= 640) return 1;
        if (w <= 1100) return 3;
        return 4;
    }

    function totalPaginasDestaque() {
        return Math.max(1, Math.ceil(destaques.length / itensVisiveisDestaque()));
    }

    function renderDestaques() {
        const secao = document.getElementById('catalogoDestaques');
        const track = document.getElementById('catalogoDestaquesTrack');
        if (!secao || !track) return;
        destaques = produtos.filter(p => p.produto_destaque);
        clearInterval(destaqueTimer);
        if (!destaques.length) { secao.style.display = 'none'; return; }
        secao.style.display = '';
        track.innerHTML = destaques.map(cardHtml).join('');
        destaqueIndex = 0;
        renderDestaqueDots();
        aplicarPosicaoDestaque();
        iniciarAutoAvancoDestaque();
    }

    function renderDestaqueDots() {
        const dots = document.getElementById('catalogoDestaquesDots');
        if (!dots) return;
        const paginas = totalPaginasDestaque();
        dots.innerHTML = paginas > 1
            ? Array.from({ length: paginas }, (_, i) => `<span data-dot="${i}"></span>`).join('')
            : '';
        dots.querySelectorAll('[data-dot]').forEach(d => d.addEventListener('click', () => {
            destaqueIndex = Number(d.dataset.dot);
            aplicarPosicaoDestaque();
            iniciarAutoAvancoDestaque();
        }));
    }

    // Define a largura de cada card via JS (em vez de % no CSS) para garantir
    // que exatamente N cards (4 desktop / 3 tablet / 1 mobile) caibam por
    // "página" — translateX por página inteira fica simples e exato.
    function aplicarPosicaoDestaque() {
        const viewport = document.querySelector('.cat-destaques-viewport');
        const track = document.getElementById('catalogoDestaquesTrack');
        if (!viewport || !track || !destaques.length) return;
        const itens = itensVisiveisDestaque();
        const gap = 14;
        const cardWidth = (viewport.offsetWidth - gap * (itens - 1)) / itens;
        [...track.children].forEach(card => {
            card.style.flex = `0 0 ${cardWidth}px`;
            card.style.marginRight = gap + 'px';
        });
        track.style.transform = `translateX(-${destaqueIndex * viewport.offsetWidth}px)`;
        document.querySelectorAll('#catalogoDestaquesDots [data-dot]').forEach((d, i) => d.classList.toggle('active', i === destaqueIndex));
    }

    function iniciarAutoAvancoDestaque() {
        clearInterval(destaqueTimer);
        if (totalPaginasDestaque() <= 1) return;
        destaqueTimer = setInterval(() => {
            destaqueIndex = (destaqueIndex + 1) % totalPaginasDestaque();
            aplicarPosicaoDestaque();
        }, 4500);
    }

    function redimensionarDestaque() {
        if (!destaques.length) return;
        destaqueIndex = Math.min(destaqueIndex, totalPaginasDestaque() - 1);
        renderDestaqueDots();
        aplicarPosicaoDestaque();
        iniciarAutoAvancoDestaque();
    }

    // variacaoIdOverride/quantidadeOverride: usados quando o item vem da página de
    // detalhe (sem card/selects na tela) — ver produto-detalhe.js
    window.adicionarItem = (produtoId, variacaoIdOverride, quantidadeOverride) => {
        const prod = produtos.find(p => Number(p.id) === Number(produtoId));
        if (!prod) return;
        const vs = variacoesDoProduto(prod);
        const comSel = temSeletor(prod);

        let variacao = vs[0];
        let quantidade = 1;

        if (variacaoIdOverride != null) {
            variacao = vs.find(v => Number(v.variacao_id) === Number(variacaoIdOverride)) || vs[0];
            if (quantidadeOverride != null) quantidade = Number(quantidadeOverride) || 1;
        } else if (comSel) {
            const card = document.querySelector(`.cat-card-seletores[data-pid="${produtoId}"]`);
            if (card) {
                const selTam = card.querySelector('.cat-sel-tamanho');
                const selQtd = card.querySelector('.cat-sel-qtd');
                const idx = selTam ? Number(selTam.value || 0) : 0;
                variacao = vs[idx] || vs[0];
                if (selQtd) quantidade = Number(selQtd.value || 1);
            }
        } else {
            // Produto simples (sem seletor) — usa a quantidade definida no stepper mobile, se houver.
            quantidade = stepperLivre.get(produtoId) || 1;
        }

        const faixa = opcoesQtd(variacao).find(f => Number(f.quantidade) === quantidade);
        const precoUnit = faixa ? Number(faixa.preco_unitario) : Number(variacao.preco_publico || 0);

        // Item com faixa de quantidade fixa: cada combinação tamanho+quantidade
        // é uma linha própria no carrinho (não soma +1 livre, troca-se a faixa).
        const key = `${produtoId}-${variacao.variacao_id}${comSel ? '-' + quantidade : ''}`;
        const existente = carrinho.find(i => i.key === key);
        if (existente && !comSel) existente.quantidade += 1;
        else if (!existente) {
            carrinho.push({
                key, produto_id: produtoId, variacao_id: variacao.variacao_id,
                nome: prod.nome, variacao: variacao.variacao,
                preco: precoUnit, quantidade, usaFaixa: comSel
            });
        }
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
            const produto = produtos.find(p => Number(p.id) === Number(i.produto_id));
            const imagem = imagensProduto(produto || {})[0] || '';
            const variacao = produto ? (variacoesDoProduto(produto).find(v => Number(v.variacao_id) === Number(i.variacao_id))) : null;
            const qtyControl = i.usaFaixa && variacao
                ? `<select class="cart-qty-select" onchange="window._cartTrocarFaixa(${idx}, this)">
                       ${opcoesQtd(variacao).map(f => `<option value="${f.quantidade}" data-preco="${f.preco_unitario}" ${f.quantidade === i.quantidade ? 'selected' : ''}>${f.quantidade} un.</option>`).join('')}
                   </select>`
                : `<button class="cart-qty-btn" onclick="alterarQtd(${idx}, ${i.quantidade - 1})" type="button">-</button>
                   <span class="cart-qty-val">${i.quantidade}</span>
                   <button class="cart-qty-btn" onclick="alterarQtd(${idx}, ${i.quantidade + 1})" type="button">+</button>`;
            return `<div class="cart-item">
                ${imagem ? `<img src="${esc(imagem)}" alt="${esc(i.nome)}">` : `<div class="cart-img-placeholder"><i class='bx bx-image'></i></div>`}
                <div class="cart-item-info">
                    <div class="cart-item-title">${esc(i.nome)}</div>
                    <div class="cart-item-price">${esc(i.variacao || '')} • ${money(i.preco)}/un</div>
                    <div class="cart-qty-box">
                        ${qtyControl}
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

    // Troca a faixa de quantidade de um item com tabela de preço por quantidade
    window._cartTrocarFaixa = (idx, sel) => {
        const item = carrinho[idx];
        if (!item) return;
        item.quantidade = Number(sel.value || 1);
        item.preco = Number(sel.selectedOptions[0]?.dataset.preco || item.preco);
        item.key = `${item.produto_id}-${item.variacao_id}-${item.quantidade}`;
        renderCarrinho();
    };

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
                    <a href="/index.html" class="footer-admin-link">
                        <i class='bx bx-lock-alt'></i> Acesso à plataforma
                    </a>
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
        const whats = whatsappDestino();
        const wfloat = document.getElementById('whatsappFloat');
        if (whats) {
            const msg = encodeURIComponent('Olá! Vim pelo catálogo ' + (loja.nome_loja || '') + ' e gostaria de atendimento.');
            if (wfloat) { wfloat.href = `https://wa.me/55${whats}?text=${msg}`; }
        } else {
            if (wfloat) wfloat.style.display = 'none';
        }
        // Hero não exibe botões — apenas os flutuantes ficam visíveis
        document.getElementById('linksContato').innerHTML = '';
        renderTopbar(); renderFooter(); iniciarBanners(); renderCarrinho(); renderCategorias(); renderProdutos(); renderDestaques();

        // Processar item pendente adicionado na página de detalhe
        const pendingCart = JSON.parse(localStorage.getItem('catalogoPending') || '[]');
        if (pendingCart.length) {
            localStorage.removeItem('catalogoPending');
            pendingCart.forEach(p => {
                const prod = produtos.find(x => Number(x.id) === Number(p.produto_id));
                if (prod) adicionarItem(prod.id, p.variacao_id, p.quantidade);
            });
        }
    }

    // Topbar: transparente → sólido ao rolar
    // Botões flutuantes: visíveis somente entre o hero e o footer
    const topbar = document.getElementById('catalogoTopbar');
    const floatEls = [
        document.querySelector('.whatsapp-float'),
        document.getElementById('floatingCartBtn'),
        document.getElementById('floatingSearch'),
    ].filter(Boolean);

    function atualizarScroll() {
        const scrollY = window.scrollY;
        topbar?.classList.toggle('scrolled', scrollY > 10);

        const hero   = document.getElementById('catalogoHeader');
        const footer = document.getElementById('catalogoFooter');
        if (!hero || !footer) return;

        const heroBottom   = hero.getBoundingClientRect().bottom;
        const footerTop    = footer.getBoundingClientRect().top;
        const visivelZona  = heroBottom <= 20 && footerTop >= window.innerHeight * 0.15;

        floatEls.forEach(el => {
            el.style.opacity       = visivelZona ? '' : '0';
            el.style.pointerEvents = visivelZona ? '' : 'none';
        });
    }

    window.addEventListener('scroll', atualizarScroll, { passive: true });
    atualizarScroll();

    window.addEventListener('resize', redimensionarDestaque);

    // Ver mais
    document.getElementById('btnVerMais')?.addEventListener('click', carregarMais);

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
