document.addEventListener('DOMContentLoaded', () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('produtos-insumos');

    const form = document.getElementById('formInsumo');
    const tbody = document.getElementById('tabelaInsumos');
    let insumos = [];
    let editando = null;

    const n = (id) => Number(String(document.getElementById(id)?.value || '0').replace(',', '.')) || 0;
    const v = (id) => document.getElementById(id)?.value || '';
    const set = (id, valor) => { const el = document.getElementById(id); if (el) el.value = valor ?? ''; };

    async function carregar() {
        insumos = await App.api('/insumos');
        renderTabela();
        renderListaCompras();
    }

    function renderTabela() {
        if (!insumos.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum insumo cadastrado.</td></tr>';
            return;
        }
        tbody.innerHTML = insumos.map(i => {
            const abaixo = Number(i.estoque_atual) <= Number(i.estoque_minimo) && Number(i.estoque_minimo) > 0;
            return `<tr>
                <td><strong>${App.escapeHtml(i.nome)}</strong>${i.observacao ? '<br><small>' + App.escapeHtml(i.observacao) + '</small>' : ''}</td>
                <td>${App.escapeHtml(i.unidade || '')}</td>
                <td><strong>${App.money(i.custo_unitario)}</strong></td>
                <td class="${abaixo ? 'text-danger' : ''}">${App.number(i.estoque_atual)} ${App.escapeHtml(i.unidade || '')}</td>
                <td>${App.number(i.estoque_minimo)} ${App.escapeHtml(i.unidade || '')}</td>
                <td>${App.badgeStatus(i.status || 'ATIVO')}</td>
                <td>
                    <button class="btn btn-small" onclick="editarInsumo(${i.id})"><i class="bx bx-edit"></i></button>
                    <button class="btn btn-small btn-danger" onclick="excluirInsumo(${i.id})"><i class="bx bx-trash"></i></button>
                </td>
            </tr>`;
        }).join('');
    }

    function renderListaCompras() {
        const baixo = insumos.filter(i =>
            i.status !== 'INATIVO' &&
            Number(i.estoque_minimo) > 0 &&
            Number(i.estoque_atual) <= Number(i.estoque_minimo)
        );
        const secao = document.getElementById('secaoListaCompras');
        const tbodyLC = document.getElementById('tbodyListaCompras');
        if (!secao || !tbodyLC) return;

        if (!baixo.length) { secao.style.display = 'none'; return; }
        secao.style.display = '';

        tbodyLC.innerHTML = baixo.map(i => {
            const sugerido = Math.max(0, Number(i.estoque_minimo) * 2 - Number(i.estoque_atual));
            const custo = sugerido * Number(i.custo_unitario || 0);
            return `<tr>
                <td><strong>${App.escapeHtml(i.nome)}</strong></td>
                <td>${App.escapeHtml(i.unidade || '')}</td>
                <td class="text-danger"><strong>${App.number(i.estoque_atual)}</strong></td>
                <td>${App.number(i.estoque_minimo)}</td>
                <td class="text-primary"><strong>${App.number(sugerido)}</strong></td>
                <td class="text-success">${App.money(custo)}</td>
            </tr>`;
        }).join('');
    }

    window.editarInsumo = (id) => {
        const i = insumos.find(x => Number(x.id) === Number(id));
        if (!i) return;
        editando = i;
        ['nome', 'unidade', 'custo_unitario', 'estoque_atual', 'estoque_minimo', 'status', 'observacao'].forEach(k => set(k, i[k] ?? ''));
        const dica = document.getElementById('dicaPreCadastro');
        if (dica) dica.style.display = i.status === 'PRE_CADASTRO' ? '' : 'none';
        document.getElementById('tituloInsumo').textContent = `Editando: ${i.nome}`;
        document.getElementById('btnCancelarEdicaoInsumo').classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    window.excluirInsumo = async (id) => {
        const ok = await App.confirmDialog({ title: 'Excluir insumo?', text: 'Precificações que já usam este insumo mantêm os valores salvos.', confirmText: 'Excluir' });
        if (!ok.isConfirmed) return;
        try { await App.api(`/insumos/${id}`, { method: 'DELETE' }); App.toast('success', 'Insumo excluído.'); carregar(); } catch (err) { App.toast('error', err.message); }
    };

    document.getElementById('status')?.addEventListener('change', (e) => {
        const dica = document.getElementById('dicaPreCadastro');
        if (dica) dica.style.display = e.target.value === 'PRE_CADASTRO' ? '' : 'none';
    });

    document.getElementById('btnCancelarEdicaoInsumo').addEventListener('click', () => {
        editando = null;
        form.reset();
        document.getElementById('tituloInsumo').textContent = 'Cadastrar insumo';
        document.getElementById('btnCancelarEdicaoInsumo').classList.add('hidden');
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {
            nome: v('nome'), unidade: v('unidade'),
            custo_unitario: n('custo_unitario'), estoque_atual: n('estoque_atual'),
            estoque_minimo: n('estoque_minimo'), status: v('status'), observacao: v('observacao') || null
        };
        try {
            if (editando) await App.api(`/insumos/${editando.id}`, { method: 'PUT', body: JSON.stringify(body) });
            else await App.api('/insumos', { method: 'POST', body: JSON.stringify(body) });
            App.toast('success', editando ? 'Insumo atualizado.' : 'Insumo cadastrado.');
            editando = null; form.reset();
            document.getElementById('btnCancelarEdicaoInsumo').classList.add('hidden');
            document.getElementById('tituloInsumo').textContent = 'Cadastrar insumo';
            carregar();
        } catch (err) { App.toast('error', err.message); }
    });

    document.getElementById('btnExportarListaCompras')?.addEventListener('click', () => {
        if (!window.XLSX) { App.toast('warning', 'XLSX não carregado.'); return; }
        const rows = [['Insumo','Unidade','Estoque Atual','Mínimo','Comprar (sugerido)','Custo Estimado']];
        document.querySelectorAll('#tbodyListaCompras tr').forEach(tr => {
            rows.push([...tr.querySelectorAll('td')].map(td => td.textContent.trim()));
        });
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Lista de Compras');
        XLSX.writeFile(wb, 'lista-compras-insumos.xlsx');
    });

    carregar().catch(err => { tbody.innerHTML = `<tr><td colspan="7">${App.escapeHtml(err.message)}</td></tr>`; });
});
