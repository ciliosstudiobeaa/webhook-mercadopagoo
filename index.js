import express from 'express';
import fetch from 'node-fetch';

const app = express();
app.use(express.json());

const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

app.post('/webhook', async (req, res) => {
  try {
    const payment = req.body;

    // Só processa pagamentos aprovados
    if (payment.status === 'approved') {

      const agendamento = {
        nome: payment.payer?.first_name + ' ' + payment.payer?.last_name,
        diaagendado: payment.metadata?.diaagendado || '',
        horaagendada: payment.metadata?.horaagendada || '',
        servico: payment.metadata?.servico || '',
        valor30: payment.transaction_amount ? `R$ ${(payment.transaction_amount * 0.3).toFixed(2)}` : '',
        status: 'Aprovado',
        whatsapp: payment.payer?.phone?.number || '',
        transaction_id: payment.id,
        reference: payment.external_reference || ''
      };

      // Envia para o Google Script
      const gsResponse = await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agendamento)
      });

      const gsData = await gsResponse.json();
      console.log('Google Script response:', gsData);
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Erro no webhook:', err);
    res.status(500).send('Erro interno');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Webhook rodando na porta ${PORT}`));
