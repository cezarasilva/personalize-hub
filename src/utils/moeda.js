function parseMoeda(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? Number(valor.toFixed(2)) : 0;
  let texto = String(valor).replace(/R\$/gi, '').replace(/\s/g, '').trim();
  if (!texto) return 0;
  const temVirgula = texto.includes(',');
  const temPonto = texto.includes('.');
  if (temVirgula && temPonto) {
    texto = texto.lastIndexOf(',') > texto.lastIndexOf('.') ? texto.replace(/\./g, '').replace(',', '.') : texto.replace(/,/g, '');
  } else if (temVirgula) texto = texto.replace(',', '.');
  texto = texto.replace(/[^0-9.-]/g, '');
  const numero = Number(texto);
  return Number.isFinite(numero) ? Number(numero.toFixed(2)) : 0;
}
function toInt(valor, padrao = 0) { const n = parseInt(valor, 10); return Number.isFinite(n) ? n : padrao; }
function money(valor) { const n = Number(valor || 0); return Number.isFinite(n) ? Number(n.toFixed(2)) : 0; }
module.exports = { parseMoeda, toInt, money };
