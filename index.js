import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
app.use(cors()); // Permite front-end de qualquer domínio
app.use(express.json());

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

if(!MP_ACCESS_TOKEN || !GOOGLE_SCRIPT_URL){
  console.error("⚠️ Variáveis de ambiente MP_ACCESS_TOKEN ou GOOGLE_SCRIPT_URL não definidas!");
  process.exit(1); // Sai imediatamente se faltar variável
}

// --- Endpoint para criar preferência de pagamento ---
app.post('/create-preference', async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;

    const preferenceData = {
      items: [
        { title: `Agendamento - ${servico}`, quantity: 1, unit_price: Number(precoTotal) }
      ],
      back_urls: {
        success: "https://seusite.com/sucesso",
        failure: "https://seusite.com/falha",
        pending: "https://seusite.com/pendente"
      },
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
    res.json(mpJson);

  } catch (err) {
    console.error('Erro create-preference:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Endpoint para receber webhook do Mercado Pago ---
app.post('/webhook', async (req, res) => {
  try {
    const payment = req.body;

    if (payment.status === 'approved') {
      const agendamento = {
        nome: payment.metadata?.nome || '',
        diaagendado: payment.metadata?.diaagendado || '',
        horaagendada: payment.metadata?.horaagendada || '',
        servico: payment.metadata?.servico || '',
        valor30: payment.transaction_amount ? `R$ ${(payment.transaction_amount*0.3).toFixed(2)}` : '',
        status: 'Aprovado',
        whatsapp: payment.metadata?.whatsapp || '',
        transaction_id: payment.id || '',
        reference: payment.external_reference || ''
      };

      // Envia para Google Script
      await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agendamento)
      });

      console.log('Agendamento enviado para Google Script:', agendamento);
    }

    res.status(200).send('OK');

  } catch (err) {
    console.error('Erro webhook:', err);
    res.status(500).send('Erro interno');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
