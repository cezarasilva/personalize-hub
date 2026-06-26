// Visualizador protegido de PDF — usado tanto na prévia do admin (cadastro
// de temas/subtemas) quanto na overlay pública de escolha de tema. Nunca usa
// <a href>/<img src> apontando para o arquivo: sempre fetch() + render em
// <canvas> via pdf.js, pra não oferecer o menu nativo de "salvar como" do
// navegador. Isso não impede print de tela/foto de câmera — só dificulta o
// reuso casual do arquivo em si (a marca d'água, aplicada no servidor, é a
// camada que sobra mesmo nesses casos).
window.PdfProtegido = (() => {
    // 4.x do pdfjs-dist deixou de publicar o build clássico (UMD/<script>),
    // só ESM (.mjs) — por isso fixo numa versão 3.x, que ainda publica
    // build/pdf.min.js + build/pdf.worker.min.js como script global.
    const PDFJS_VERSION = '3.11.174';
    let pdfjsReadyPromise = null;

    function carregarPdfJs() {
        if (window.pdfjsLib) return Promise.resolve();
        if (pdfjsReadyPromise) return pdfjsReadyPromise;
        pdfjsReadyPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`;
            script.onload = () => {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;
                resolve();
            };
            script.onerror = () => reject(new Error('Falha ao carregar o visualizador de PDF.'));
            document.head.appendChild(script);
        });
        return pdfjsReadyPromise;
    }

    function bloquearAcoes(containerEl) {
        containerEl.oncontextmenu = () => false;
        containerEl.style.userSelect = 'none';
        containerEl.style.webkitUserSelect = 'none';
        const onKeydown = (e) => {
            const k = (e.key || '').toLowerCase();
            if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'u'].includes(k)) e.preventDefault();
        };
        document.addEventListener('keydown', onKeydown);
        return () => document.removeEventListener('keydown', onKeydown);
    }

    // Retorna uma função de limpeza — chame ao fechar o modal/overlay que
    // contém a prévia, pra remover o listener de teclado.
    // `paginaUnica`: renderiza só a 1ª página (miniatura de card) em vez de
    // todas (usado na prévia ampliada).
    async function renderizar(containerEl, endpointPreview, { autenticado = false, paginaUnica = false, escala = 1.3 } = {}) {
        containerEl.innerHTML = '<div class="pdf-protegido-loading"><i class="bx bx-loader-alt bx-spin"></i></div>';
        const desbloquear = bloquearAcoes(containerEl);
        try {
            await carregarPdfJs();
            const headers = {};
            if (autenticado && window.App?.token?.()) headers.Authorization = `Bearer ${window.App.token()}`;
            const resp = await fetch(endpointPreview, { headers });
            if (!resp.ok) throw new Error('Não foi possível carregar a prévia.');
            const bytes = await resp.arrayBuffer();

            const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
            containerEl.innerHTML = '';
            const totalPaginas = paginaUnica ? 1 : pdf.numPages;
            for (let n = 1; n <= totalPaginas; n++) {
                const page = await pdf.getPage(n);
                const viewport = page.getViewport({ scale: escala });
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                canvas.style.maxWidth = '100%';
                canvas.style.display = 'block';
                if (!paginaUnica) canvas.style.marginBottom = '8px';
                canvas.oncontextmenu = () => false;
                containerEl.appendChild(canvas);
                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            }
        } catch (e) {
            containerEl.innerHTML = `<p style="text-align:center;padding:12px;color:#dc2626;font-size:12px">${(e && e.message) || 'Erro ao carregar prévia.'}</p>`;
        }
        return desbloquear;
    }

    return { renderizar };
})();
