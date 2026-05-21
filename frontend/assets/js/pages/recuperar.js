document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('formRecuperar');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnEnviar');
        btn.disabled = true;
        btn.textContent = 'Enviando...';
        App.setMsg('mensagem', '⏳ Enviando link...', 'muted');
        try {
            const dados = await App.api('/usuarios/recuperar', { method: 'POST', body: JSON.stringify(App.formDataToObject(form)) });
            App.setMsg('mensagem', dados.link_dev ? `✅ ${dados.mensagem} Link DEV: ${dados.link_dev}` : `✅ ${dados.mensagem}`, 'success');
            form.reset();
        } catch (err) {
            App.setMsg('mensagem', `❌ ${err.message}`, 'danger');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Enviar link';
        }
    });
});
