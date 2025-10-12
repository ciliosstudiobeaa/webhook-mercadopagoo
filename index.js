import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// CONFIGURAÇÃO
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxKtox0VU2EMvKzZdRLCVAr-zSMuGK-8THdqlE9vh3oj4BqQfmgNlNFYV99HGMItN07/exec";
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

// CRIAR PREFERÊNCIA (CHECKOUT)
app.post("/create-preference", async (req, res) => {
  try {
    const { nome, telefone, servico, precoTotal, data, hora } = req.body;
    console.log("Criando preferência:", req.body);

    const resp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`
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
    console.error("Erro ao criar preferência:", err);
    res.status(500).json({ error: "Erro ao criar preferência" });
  }
});

// WEBHOOK MERCADO PAGO
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    console.log("Webhook recebido:", JSON.stringify(body, null, 2));

    if (body.action !== "payment.updated") return res.sendStatus(200);

    const paymentId = body.data?.id;
    if (!paymentId) return res.sendStatus(400);

    const resp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });

    const pagamento = await resp.json();

    if (pagamento.status !== "approved") return res.sendStatus(200);

    const { nome, telefone, servico, data, hora } = pagamento.metadata || {};
    if (!nome || !telefone || !servico || !data || !hora) return res.sendStatus(200);

    const sheetResp = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentId: pagamento.id,
        nome,
        diaagendado: data,
        horaagendada: hora,
        servico,
        valor: pagamento.transaction_amount,
        status: "Aprovado",
        whatsapp: telefone
      })
    });

    const sheetResult = await sheetResp.text();
    console.log("Resposta da planilha:", sheetResult);

    res.sendStatus(200);

  } catch (err) {
    console.error("Erro no webhook:", err);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Webhook ativo na porta ${PORT}`));
