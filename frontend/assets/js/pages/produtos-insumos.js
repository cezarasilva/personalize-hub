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
        if (!insumos.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum insumo cadastrado.</td></tr>';
            return;
        }
        tbody.innerHTML = insumos.map(i => `
            <tr>
                <td><strong>${App.escapeHtml(i.nome)}</strong>${i.observacao ? '<br><small>' + App.escapeHtml(i.observacao) + '</small>' : ''}</td>
                <td>${App.escapeHtml(i.unidade || '')}</td>
                <td><strong>${App.money(i.custo_unitario)}</strong></td>
                <td>${App.number(i.estoque_atual)} ${App.escapeHtml(i.unidade || '')}</td>
                <td>${App.badgeStatus(i.status || 'ATIVO')}</td>
                <td><button class="btn btn-small" onclick="editarInsumo(${i.id})"><i class="bx bx-edit"></i></button> <button class="btn btn-small btn-danger" onclick="excluirInsumo(${i.id})"><i class="bx bx-trash"></i></button></td>
            </tr>
        `).join('');
    }

    window.editarInsumo = (id) => {
        const i = insumos.find(x => Number(x.id) === Number(id));
        if (!i) return;
        editando = i;
        ['nome', 'unidade', 'custo_unitario', 'estoque_atual', 'status', 'observacao'].forEach(k => set(k, i[k] ?? ''));
        document.getElementById('tituloInsumo').textContent = `Editando: ${i.nome}`;
        document.getElementById('btnCancelarEdicaoInsumo').classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    window.excluirInsumo = async (id) => {
        const ok = await App.confirmDialog({ title: 'Excluir insumo?', text: 'Precificações que já usam este insumo mantêm os valores salvos.', confirmText: 'Excluir' });
        if (!ok.isConfirmed) return;
        try { await App.api(`/insumos/${id}`, { method: 'DELETE' }); App.toast('success', 'Insumo excluído.'); carregar(); } catch (err) { App.toast('error', err.message); }
    };

    document.getElementById('btnCancelarEdicaoInsumo').addEventListener('click', () => {
        editando = null;
        form.reset();
        document.getElementById('tituloInsumo').textContent = 'Cadastrar insumo';
        document.getElementById('btnCancelarEdicaoInsumo').classList.add('hidden');
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {
            nome: v('nome'), unidade: v('unidade'), custo_unitario: n('custo_unitario'), estoque_atual: n('estoque_atual'),
            status: v('status'), observacao: v('observacao') || null
        };
        try {
            if (editando) await App.api(`/insumos/${editando.id}`, { method: 'PUT', body: JSON.stringify(body) });
            else await App.api('/insumos', { method: 'POST', body: JSON.stringify(body) });
            App.toast('success', editando ? 'Insumo atualizado.' : 'Insumo cadastrado.');
            editando = null; form.reset(); document.getElementById('btnCancelarEdicaoInsumo').classList.add('hidden'); document.getElementById('tituloInsumo').textContent = 'Cadastrar insumo';
            carregar();
        } catch (err) { App.toast('error', err.message); }
    });

    carregar().catch(err => { tbody.innerHTML = `<tr><td colspan="6">${App.escapeHtml(err.message)}</td></tr>`; });
});
