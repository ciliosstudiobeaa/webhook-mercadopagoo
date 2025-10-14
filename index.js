import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

const paymentStatusMap = {};

// ✅ ROTA DE TESTE
app.get("/", (req, res) => {
  res.send("Servidor ativo — integração Mercado Pago + Google Sheets rodando!");
});

// ✅ GERAR PAGAMENTO
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;

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
        success: `https://webhook-mercadopagoo.onrender.com/redirect-sucesso`,
        failure: "https://ciliosdabea.netlify.app/erro.html",
      },
      auto_return: "approved",
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

    paymentStatusMap[data.id] = {
      status: "pending",
      rowData: { nome, whatsapp, servico, diaagendado, horaagendada, precoTotal },
    };

    return res.json({ init_point: data.init_point, paymentId: data.id });
  } catch (err) {
    console.error("❌ Erro ao gerar pagamento:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ✅ WEBHOOK MERCADO PAGO
app.post("/webhook", async (req, res) => {
  try {
    const paymentId = req.body?.data?.id;
    if (!paymentId) return res.status(200).json({ ok: false, msg: "Sem paymentId" });

    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    const paymentData = await paymentRes.json();
    const status = paymentData.status;

    if (status === "approved") {
      const metadata = paymentData.metadata || {};
      const rowData = {
        nome: metadata.nome || "Desconhecido",
        diaagendado: metadata.diaagendado || "",
        horaagendada: metadata.horaagendada || "",
        servico: metadata.servico || "",
        valor30: paymentData.transaction_amount || "",
        status: "Aprovado",
        whatsapp: metadata.whatsapp || "",
        transaction_id: paymentData.transaction_details?.transaction_id || paymentData.id || "",
        reference: "MP-" + paymentId,
      };

      // Envia para Google Script
      await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rowData),
      });

      paymentStatusMap[paymentId] = { status: "approved", rowData };
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ REDIRECT DE SUCESSO (corrigido)
app.get("/redirect-sucesso", async (req, res) => {
  try {
    // MP pode mandar payment_id, collection_id ou preference_id
    const paymentId = req.query.payment_id || req.query.collection_id || req.query.preference_id;

    if (!paymentId) {
      console.log("❌ Nenhum payment_id recebido no redirect.");
      return res.redirect("https://ciliosdabea.netlify.app/erro.html");
    }

    // Busca local ou direto no MP
    let record = paymentStatusMap[paymentId];

    if (!record) {
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      });
      const mpData = await mpRes.json();

      if (mpData.status === "approved") {
        record = {
          status: "approved",
          rowData: mpData.metadata || {},
        };
      }
    }

    if (!record || record.status !== "approved") {
      console.log("⚠️ Pagamento ainda não aprovado no redirect:", paymentId);
      return res.redirect("https://ciliosdabea.netlify.app/erro.html");
    }

    const { nome, servico, diaagendado, horaagendada, whatsapp } = record.rowData;
    const query = new URLSearchParams({ nome, servico, diaagendado, horaagendada, whatsapp }).toString();

    return res.redirect(`https://ciliosdabea.netlify.app/sucesso.html?${query}`);
  } catch (err) {
    console.error("❌ Erro no redirect-sucesso:", err);
    return res.redirect("https://ciliosdabea.netlify.app/erro.html");
  }
});

// ✅ STATUS DE PAGAMENTO (polling)
app.get("/status-pagamento", (req, res) => {
  const { paymentId } = req.query;
  if (!paymentId) return res.status(400).json({ ok: false, msg: "paymentId necessário" });

  const record = paymentStatusMap[paymentId];
  if (!record) return res.json({ status: "pending" });

  res.json({ status: record.status, rowData: record.rowData });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
