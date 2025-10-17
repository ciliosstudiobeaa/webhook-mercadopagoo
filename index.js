// webhook.js (arquivo independente)
// Para usar: no seu index principal -> const webhook = require('./webhook'); app.use('/', webhook);

const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

// Função para garantir que a data fique no formato correto DD/MM/YYYY
function formatDate(dateStr) {
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0'); // Meses começam do 0
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

router.post("/webhook", async (req, res) => {
  try {
    const { action, data } = req.body;
    console.log("📬 [Webhook] Recebido:", req.body);

    if (action === "payment.created" || action === "payment.updated") {
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      });
      const payment = await mpRes.json();
      console.log("💳 [MP] Dados do pagamento:", payment);

      if (payment.status === "approved") {
        console.log("✅ Pagamento aprovado! Enviando para a planilha...");

        // Corrige a data antes de enviar
        const diaFormatado = payment.metadata?.diaagendado
          ? formatDate(payment.metadata.diaagendado)
          : "";

        await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            servico: payment.metadata?.servico,
            diaagendado: diaFormatado,
            horaagendada: payment.metadata?.horaagendada,
            status: "Aprovado",
          }),
        });
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ ERRO EM /webhook:", err.message || err);
    res.status(500).send("Erro");
  }
});

module.exports = router;
