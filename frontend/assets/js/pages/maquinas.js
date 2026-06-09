document.addEventListener('DOMContentLoaded', () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('maquinas');

    const form = document.getElementById('formMaquina');
    const tbody = document.getElementById('tabelaMaquinas');
    let maquinas = [];
    let editando = null;

    const n = (id) => Number(String(document.getElementById(id)?.value || '0').replace(',', '.')) || 0;
    const v = (id) => document.getElementById(id)?.value || '';
    const set = (id, valor) => { const el = document.getElementById(id); if (el) el.value = valor ?? ''; };

    function calcularPreview() {
        const valorCompra = n('valor_compra');
        const vida = n('vida_util_horas');
        const potencia = n('potencia_kw');
        const kwh = n('valor_kwh');
        const manut = n('custo_manutencao_hora');
        const manual = document.getElementById('usar_custo_manual').checked;
        const custoManual = n('custo_hora_manual');
        const dep = vida > 0 ? valorCompra / vida : 0;
        const energia = potencia * kwh;
        const calculado = dep + energia + manut;
        const final = manual && custoManual > 0 ? custoManual : calculado;
        document.getElementById('resDepreciacao').textContent = App.money(dep);
        document.getElementById('resEnergia').textContent = App.money(energia);
        document.getElementById('resManutencao').textContent = App.money(manut);
        document.getElementById('resCustoHora').textContent = App.money(final);
        return { dep, energia, calculado, final };
    }

    async function carregar() {
        maquinas = await App.api('/maquinas');
        if (!maquinas.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhuma máquina cadastrada.</td></tr>';
            return;
        }
        tbody.innerHTML = maquinas.map(m => `
            <tr>
                <td><strong>${App.escapeHtml(m.nome)}</strong><br><small>${App.escapeHtml(m.modelo || '')}${m.observacao ? ' · ' + App.escapeHtml(m.observacao) : ''}</small></td>
                <td>${App.escapeHtml(m.tipo || '')}</td>
                <td><strong>${App.money(m.custo_total_hora)}</strong><br><small>${m.usar_custo_manual ? 'manual' : 'calculado'}</small></td>
                <td><small>Dep: ${App.money(m.custo_depreciacao_hora)} • Energia: ${App.money(m.custo_energia_hora)} • Manut: ${App.money(m.custo_manutencao_hora)}</small></td>
                <td>${App.badgeStatus(m.status || 'ATIVA')}</td>
                <td><button class="btn btn-small" onclick="editarMaquina(${m.id})"><i class="bx bx-edit"></i></button> <button class="btn btn-small btn-danger" onclick="excluirMaquina(${m.id})"><i class="bx bx-trash"></i></button></td>
            </tr>
        `).join('');
    }

    window.editarMaquina = (id) => {
        const m = maquinas.find(x => Number(x.id) === Number(id));
        if (!m) return;
        editando = m;
        ['nome','modelo','tipo','valor_compra','vida_util_horas','potencia_kw','valor_kwh','custo_manutencao_hora','custo_hora_manual','status','observacao'].forEach(k => set(k, m[k] ?? ''));
        document.getElementById('usar_custo_manual').checked = !!m.usar_custo_manual;
        document.getElementById('tituloMaquina').textContent = `Editando: ${m.nome}`;
        document.getElementById('btnCancelarEdicaoMaquina').classList.remove('hidden');
        calcularPreview();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    window.excluirMaquina = async (id) => {
        const ok = await App.confirmDialog({ title: 'Excluir máquina?', text: 'A máquina será removida da lista. Históricos antigos continuam com snapshot.', confirmText: 'Excluir' });
        if (!ok.isConfirmed) return;
        try { await App.api(`/maquinas/${id}`, { method: 'DELETE' }); App.toast('success', 'Máquina excluída.'); carregar(); } catch (err) { App.toast('error', err.message); }
    };

    document.querySelectorAll('#formMaquina input, #formMaquina select').forEach(el => el.addEventListener('input', calcularPreview));
    document.getElementById('btnCancelarEdicaoMaquina').addEventListener('click', () => { editando = null; form.reset(); set('vida_util_horas', 20000); set('potencia_kw', 0.20); set('valor_kwh', 0.90); set('observacao', ''); document.getElementById('tituloMaquina').textContent = 'Cadastrar máquina'; document.getElementById('btnCancelarEdicaoMaquina').classList.add('hidden'); calcularPreview(); });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {
            nome: v('nome'), modelo: v('modelo'), tipo: v('tipo'), status: v('status'),
            valor_compra: n('valor_compra'), vida_util_horas: n('vida_util_horas'), potencia_kw: n('potencia_kw'), valor_kwh: n('valor_kwh'),
            custo_manutencao_hora: n('custo_manutencao_hora'), custo_hora_manual: n('custo_hora_manual'), usar_custo_manual: document.getElementById('usar_custo_manual').checked,
            observacao: v('observacao') || null
        };
        try {
            if (editando) await App.api(`/maquinas/${editando.id}`, { method: 'PUT', body: JSON.stringify(body) });
            else await App.api('/maquinas', { method: 'POST', body: JSON.stringify(body) });
            App.toast('success', editando ? 'Máquina atualizada.' : 'Máquina cadastrada.');
            editando = null; form.reset(); set('vida_util_horas', 20000); set('potencia_kw', 0.20); set('valor_kwh', 0.90); document.getElementById('btnCancelarEdicaoMaquina').classList.add('hidden'); document.getElementById('tituloMaquina').textContent = 'Cadastrar máquina'; calcularPreview(); carregar();
        } catch (err) { App.toast('error', err.message); }
    });

    calcularPreview();
    carregar().catch(err => { tbody.innerHTML = `<tr><td colspan="6">${App.escapeHtml(err.message)}</td></tr>`; });
});
