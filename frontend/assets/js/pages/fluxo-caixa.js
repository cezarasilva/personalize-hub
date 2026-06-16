document.addEventListener('DOMContentLoaded', async () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('relatorios-fluxo');

    const selMes = document.getElementById('selMes');
    const selAno = document.getElementById('selAno');
    const btnCarregar = document.getElementById('btnCarregarFluxo');
    const tbody = document.getElementById('tbodyFluxo');
    let chart = null;
    let dadosAtuais = null;

    const agora = new Date();
    for (let a = agora.getFullYear(); a >= agora.getFullYear() - 3; a--) {
        selAno.innerHTML += `<option value="${a}"${a === agora.getFullYear() ? ' selected' : ''}>${a}</option>`;
    }
    selMes.value = String(agora.getMonth() + 1);

    async function carregar() {
        const mes = selMes.value;
        const ano = selAno.value;
        try {
            btnCarregar.disabled = true;
            const data = await App.api(`/financeiro/fluxo-caixa?mes=${mes}&ano=${ano}`);
            dadosAtuais = data;
            renderFluxo(data);
        } catch (e) {
            App.toast('error', e.message);
        } finally {
            btnCarregar.disabled = false;
        }
    }

    function renderFluxo(data) {
        document.getElementById('totalEntradas').textContent = App.money(data.total_entradas);
        document.getElementById('totalSaidas').textContent  = App.money(data.total_saidas);
        document.getElementById('lucroLiquido').textContent = App.money(data.lucro_liquido);

        const semanas = data.semanas || [];
        tbody.innerHTML = semanas.map(s => {
            const saldo = Number(s.entradas || 0) - Number(s.saidas || 0);
            return `<tr>
                <td>Semana ${s.semana}</td>
                <td class="text-success">${App.money(s.entradas)}</td>
                <td class="text-danger">${App.money(s.saidas)}</td>
                <td class="${saldo >= 0 ? 'text-success' : 'text-danger'}">${App.money(saldo)}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="4" class="empty-state">Sem dados.</td></tr>';

        const ctx = document.getElementById('graficoFluxo');
        if (chart) chart.destroy();
        chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: semanas.map(s => `Sem. ${s.semana}`),
                datasets: [
                    { label: 'Entradas', data: semanas.map(s => Number(s.entradas || 0)), backgroundColor: 'rgba(34,197,94,.7)' },
                    { label: 'Saídas',   data: semanas.map(s => Number(s.saidas   || 0)), backgroundColor: 'rgba(239,68,68,.7)' }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#e5e7eb' } } },
                scales: {
                    x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.12)' } },
                    y: { beginAtZero: true, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.12)' } }
                }
            }
        });
    }

    btnCarregar.addEventListener('click', carregar);
    document.getElementById('btnExportarFluxo')?.addEventListener('click', () => {
        if (!dadosAtuais || !window.XLSX) { App.toast('warning', 'Carregue os dados primeiro.'); return; }
        const rows = [['Semana','Entradas','Saídas','Saldo']];
        (dadosAtuais.semanas || []).forEach(s => {
            const saldo = Number(s.entradas || 0) - Number(s.saidas || 0);
            rows.push([`Semana ${s.semana}`, Number(s.entradas || 0), Number(s.saidas || 0), saldo]);
        });
        rows.push([]);
        rows.push(['Total Entradas', Number(dadosAtuais.total_entradas || 0)]);
        rows.push(['Total Saídas',   Number(dadosAtuais.total_saidas   || 0)]);
        rows.push(['Lucro Líquido',  Number(dadosAtuais.lucro_liquido  || 0)]);
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Fluxo de Caixa');
        XLSX.writeFile(wb, `fluxo-caixa-${dadosAtuais.mes}-${dadosAtuais.ano}.xlsx`);
    });

    carregar();
});
