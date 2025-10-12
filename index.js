import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// Cria preferência de pagamento
app.post("/create-preference", async (req, res) => {
  try {
    const { nome, telefone, servico, precoTotal, data, hora } = req.body;

    const resp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        items: [{ title: servico, quantity: 1, unit_price: parseFloat(precoTotal) }],
        metadata: { nome, telefone, servico, data, hora },
        back_urls: { success: "https://seusite.com/success", failure: "https://seusite.com/failure" },
        auto_return: "approved"
      })
    });

    const preference = await resp.json();
    res.json({ init_point: preference.init_point });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar preferência" });
  }
});

// Webhook Mercado Pago
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    console.log("Webhook recebido:", body);

    if (body.action === "payment.updated") {
      const paymentId = body.data.id;

      const resp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` }
      });

      const pagamento = await resp.json();

      if (pagamento.status === "approved") {
        const { nome, telefone, servico, data, hora } = pagamento.metadata;

        await fetch("https://script.google.com/macros/s/AKfycbxKtox0VU2EMvKzZdRLCVAr-zSMuGK-8THdqlE9vh3oj4BqQfmgNlNFYV99HGMItN07/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nome,
            diaagendado: data,
            horaagendada: hora,
            servico,
            valor: pagamento.transaction_amount,
            status: "Aprovado",
            whatsapp: telefone
          })
        });
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Webhook ativo na porta ${PORT}`));
