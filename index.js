import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// === VARIÁVEIS DE AMBIENTE ===
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

// === MAPA LOCAL DE STATUS ===
const paymentStatusMap = {};

// === TESTE ===
app.get("/", (req, res) => {
  res.send("🚀 Servidor ativo — Cílios da Bea integrado com Mercado Pago e Google Sheets!");
});

// === GERAR PAGAMENTO ===
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;
    console.log("📦 Dados recebidos do front:", req.body);

    // Cria a preferência de pagamento
    const body = {
      items: [
        {
          title: `Sinal de agendamento - ${servico}`,
          quantity: 1,
          currency_id: "BRL",
          unit_price: parseFloat(precoTotal * 0.3),
        },
      ],
      payer: { name: nome, email: `${whatsapp}@ciliosdabea.fake` },
      metadata: { nome, whatsapp, servico, diaagendado, horaagendada },
      back_urls: {
        success: `https://ciliosdabea.netlify.app/aguardando.html?paymentId=__PAYMENT_ID__&nome=${encodeURIComponent(
          nome
        )}&whatsapp=${encodeURIComponent(whatsapp)}&servico=${encodeURIComponent(
          servico
        )}&diaagendado=${encodeURIComponent(
          diaagendado
        )}&horaagendada=${encodeURIComponent(horaagendada)}`,
        failure: "https://ciliosdabea.netlify.app/erro.html",
      },
      auto_return: "approved",
      notification_url: "https://webhook-mercadopagoo.onrender.com/webhook",
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await mpRes.json();
    console.log("✅ Preferência criada com sucesso:", data);

    paymentStatusMap[data.id] = { status: "pending" };
    return res.json({ init_point: data.init_point, id: data.id });
  } catch (err) {
    console.error("❌ Erro ao gerar pagamento:", err);
    return res.status(500).json({ error: err.message });
  }
});

// === WEBHOOK DO MERCADO PAGO ===
app.post("/webhook", async (req, res) => {
  try {
    console.log("📩 Webhook recebido:", JSON.stringify(req.body, null, 2));

    const paymentId = req.body?.data?.id;
    if (!paymentId) {
      console.warn("⚠️ Webhook sem paymentId válido.");
      return res.status(200).json({ ok: false });
    }

    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });

    const paymentData = await paymentRes.json();
    console.log("💳 Detalhes do pagamento:", paymentData);

    const status = paymentData.status;

    if (status === "approved") {
      console.log("✅ Pagamento aprovado, enviando dados para o Google Sheets...");

      const meta = paymentData.metadata || {};
      const rowData = {
        nome: meta.nome,
        whatsapp: meta.whatsapp,
        servico: meta.servico,
        diaagendado: meta.diaagendado,
        horaagendada: meta.horaagendada,
        valor30: paymentData.transaction_amount,
        status: "Aprovado",
        reference: "MP-" + paymentId,
      };

      await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rowData),
      });

      paymentStatusMap[paymentData.order?.id || paymentId] = { status: "approved" };
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    res.status(500).json({ error: err.message });
  }
});

// === STATUS DO PAGAMENTO ===
app.get("/status-pagamento", (req, res) => {
  const { paymentId } = req.query;
  const status = paymentStatusMap[paymentId]?.status || "pending";
  console.log(`🔍 Consulta de status ${paymentId}: ${status}`);
  res.json({ status });
});

// === INICIALIZA SERVIDOR ===
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🔥 Servidor rodando na porta ${PORT}`));
