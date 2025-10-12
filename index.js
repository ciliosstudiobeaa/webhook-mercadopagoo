import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
app.use(express.json());

// Ambientes
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN; // obrigatório
const GOOGLE_WEBAPP_URL = process.env.GOOGLE_WEBAPP_URL; // obrigatório

if (!MP_ACCESS_TOKEN) console.warn("AVISO: MP_ACCESS_TOKEN não definido.");
if (!GOOGLE_WEBAPP_URL) console.warn("AVISO: GOOGLE_WEBAPP_URL não definido.");

function makeReference() {
  return Date.now().toString(36) + "-" + crypto.randomBytes(4).toString('hex');
}

// Rota simples para healthcheck
app.get("/", (req,res) => res.send("Webhook-mercadopago backend OK"));

// 1) create-preference
app.post("/create-preference", async (req,res) => {
  try {
    const { nome, telefone, servico, precoTotal, dataSessao, horarioSessao } = req.body;

    if (!nome || !telefone || !servico || !precoTotal || !dataSessao || !horarioSessao) {
      return res.status(400).json({ error: "Dados incompletos no create-preference" });
    }

    const reference = makeReference();
    const sinal = Number(precoTotal) * 0.3;

    const preferenceBody = {
      items: [{
        title: `${servico} — Agendamento`,
        quantity: 1,
        unit_price: Number(sinal.toFixed(2)),
        currency_id: "BRL"
      }],
      payer: {
        name: nome,
        phone: { number: String(telefone) }
      },
      metadata: {
        reference,
        nome,
        telefone,
        servico,
        dataSessao,
        horarioSessao,
        precoTotal
      },
      notification_url: (process.env.WEBHOOK_URL || ""),
      back_urls: {
        success: (process.env.BACK_URL_SUCCESS || "https://seusite.com/success"),
        failure: (process.env.BACK_URL_FAILURE || "https://seusite.com/failure")
      },
      auto_return: "approved"
    };

    const mpResp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(preferenceBody)
    });
    const mpData = await mpResp.json();
    console.log("Preference criada:", mpData);

    const addPayload = {
      action: "add_pending",
      reference,
      nome,
      diaagendado: dataSessao,
      horaagendada: horarioSessao,
      servico,
      "valor 30%": Number(sinal.toFixed(2)),
      whatsapp: telefone
    };

    const sheetResp = await fetch(GOOGLE_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(addPayload)
    });

    const sheetResult = await sheetResp.text();
    console.log("Resultado add_pending na planilha:", sheetResult);

    return res.json({ init_point: mpData.init_point, preference: mpData });
  } catch (err) {
    console.error("Erro create-preference:", err);
    return res.status(500).json({ error: "Erro interno create-preference" });
  }
});

// 2) webhook endpoint
app.post("/webhook", async (req,res) => {
  try {
    console.log("Webhook recebido:", JSON.stringify(req.body, null, 2));

    // Aqui pegamos o paymentId corretamente
    const paymentId = req.body.data?.id 
                    || req.body?.id 
                    || req.body.transaction_details?.transaction_id 
                    || null;

    if (!paymentId) {
      console.log("Webhook sem paymentId; ignorando.");
      return res.status(200).send("No paymentId");
    }

    const payResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { "Authorization": `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const paymentData = await payResp.json();
    console.log("Pagamento consultado:", JSON.stringify(paymentData, null, 2));

    if (paymentData.status !== "approved") {
      console.log("Pagamento com status:", paymentData.status);
      return res.status(200).send("Pagamento não aprovado");
    }

    // Pegando reference da metadata
    const reference = paymentData.metadata?.reference;
    if (!reference) {
      console.log("Reference ausente no pagamento (metadata)", paymentData.metadata);
      return res.status(200).send("No reference");
    }

    // Enviando para Apps Script com transaction_id se paymentData.id não existir
    const confirmPayload = {
      action: "confirm",
      reference,
      paymentId: paymentData.id || paymentData.transaction_details?.transaction_id,
      valor30: paymentData.transaction_amount,
      status: "Aprovado"
    };

    const confirmResp = await fetch(GOOGLE_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(confirmPayload)
    });

    const confirmResult = await confirmResp.text();
    console.log("Resposta Apps Script confirm:", confirmResult);

    return res.status(200).send("OK");
  } catch (err) {
    console.error("Erro no webhook handler:", err);
    return res.status(500).send("Erro interno webhook");
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> console.log(`Servidor rodando na porta ${PORT}`));
