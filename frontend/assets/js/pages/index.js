document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('formLogin');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnEntrar');
        App.setMsg('mensagem', '⏳ Verificando...', 'muted');
        btn.disabled = true;
        btn.textContent = 'Acessando...';
        try {
            const payload = App.formDataToObject(form);
            const dados = await App.api('/login', { method: 'POST', body: JSON.stringify(payload) });
            App.setUser(dados);
            window.location.href = dados.usuario?.perfil === 'PARCEIRO' ? 'parceiro-dashboard.html' : 'dashboard.html';
        } catch (err) {
            App.setMsg('mensagem', ` ${err.message}`, 'danger');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Entrar no Sistema';
        }
    });
});
