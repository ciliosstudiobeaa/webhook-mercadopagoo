import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

if (!MP_ACCESS_TOKEN || !GOOGLE_SCRIPT_URL) {
  console.error("⚠️ Variáveis de ambiente MP_ACCESS_TOKEN ou GOOGLE_SCRIPT_URL não definidas!");
  process.exit(1);
}

// Criar link de pagamento
app.post('/create-preference', async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;

    const preferenceData = {
      items: [{ title: `Agendamento - ${servico}`, quantity: 1, unit_price: Number(precoTotal) }],
      back_urls: { success: "https://sucesso.com", failure: "https://falha.com", pending: "https://pendente.com" },
      auto_return: "approved",
      external_reference: `${Date.now()}`,
      metadata: { nome, whatsapp, servico, diaagendado, horaagendada }
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(preferenceData)
    });

    const mpJson = await mpRes.json();
    console.log("Preference criado:", mpJson);
    res.json(mpJson);

  } catch (err) {
    console.error("Erro create-preference:", err);
    res.status(500).json({ error: err.message });
  }
});

// Webhook Mercado Pago
app.post('/webhook', async (req, res) => {
  try {
    const webhook = req.body;
    console.log("Webhook recebido:", JSON.stringify(webhook));

    // Pega o payment_id
    const payment_id = webhook.data?.id;
    if (!payment_id) {
      console.log("Webhook sem payment_id. Ignorando.");
      return res.status(200).send('OK');
    }

    // Busca os detalhes completos do pagamento
    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${payment_id}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const payment = await paymentRes.json();
    console.log("Detalhes do pagamento:", payment);

    if (payment.status === 'approved') {
      console.log("Pagamento aprovado! Enviando para Google Script...");

      const agendamento = {
        nome: payment.metadata?.nome || '',
        diaagendado: payment.metadata?.diaagendada || '',
        horaagendada: payment.metadata?.horaagendada || '',
        servico: payment.metadata?.servico || '',
        valor30: payment.transaction_amount ? `R$ ${(payment.transaction_amount*0.3).toFixed(2)}` : '',
        status: 'Aprovado',
        whatsapp: payment.metadata?.whatsapp || '',
        transaction_id: payment.id || '',
        reference: payment.external_reference || ''
      };

      try {
        const gsRes = await fetch(GOOGLE_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(agendamento)
        });
        const gsJson = await gsRes.json();
        console.log("Resposta do Google Script:", gsJson);

      } catch(errGS) {
        console.error("Erro ao enviar para Google Script:", errGS);
      }

    } else {
      console.log("Pagamento não aprovado ainda, status:", payment.status);
    }

    res.status(200).send('OK');

  } catch (err) {
    console.error("Erro no webhook:", err);
    res.status(500).send('Erro interno');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
           
