import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// === VARIÁVEIS DE AMBIENTE ===
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

// === Rota para gerar pagamento ===
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;

    const preference = {
      items: [{ title: servico, quantity: 1, unit_price: parseFloat(precoTotal) }],
      payer: { name: nome },
      external_reference: whatsapp,
      metadata: { diaagendado, horaagendada },
      back_urls: { success: "", pending: "", failure: "" },
      auto_return: "approved"
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(preference)
    });

    const json = await mpRes.json();
    res.json(json);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao gerar pagamento" });
  }
});

// === Rota para horários bloqueados ===
app.get("/horarios-bloqueados", async (req, res) => {
  try {
    const date = req.query.date;
    if (!date) return res.json([]);

    const gRes = await fetch(GOOGLE_SCRIPT_URL);
    const horarios = await gRes.json();

    // Filtra por data e status aprovado
    const blocked = horarios
      .filter(h => h.diaagendado === date && h.status === "Aprovado")
      .map(h => h.horaagendada);

    res.json(blocked);
  } catch (e) {
    console.error(e);
    res.json([]);
  }
});

// === Webhook Mercado Pago ===
app.post("/mp-webhook", async (req, res) => {
  try {
    const { type, data } = req.body;
    if (type !== "payment") return res.sendStatus(200);

    const paymentId = data.id;

    // Buscar detalhes do pagamento
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const payment = await mpRes.json();

    if (payment.status === "approved") {
      await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: payment.payer?.first_name || "Cliente",
          whatsapp: payment.external_reference || "",
          servico: payment.description,
          precoTotal: payment.transaction_amount,
          diaagendado: payment.metadata?.diaagendado || "",
          horaagendada: payment.metadata?.horaagendada || "",
          status: "Aprovado"
        })
      });
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("Erro webhook:", e);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend rodando na porta ${PORT}`));
