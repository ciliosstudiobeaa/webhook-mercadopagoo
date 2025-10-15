import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

const paymentStatusMap = {};

// ROTA DE TESTE
app.get("/", (req, res) => {
  console.log("✅ Servidor ativo");
  res.send("Servidor rodando — Mercado Pago + Google Sheets");
});

// GERAR PAGAMENTO
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;
    console.log("📦 Dados recebidos para pagamento:", req.body);

    const body = {
      items: [
        { title: `Sinal de agendamento - ${servico}`, quantity: 1, currency_id: "BRL", unit_price: parseFloat(precoTotal * 0.3) }
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
        "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await mpRes.json();
    console.log("💳 Retorno Mercado Pago:", data);

    if (!data.id || !data.init_point) {
      console.error("❌ Retorno inválido do Mercado Pago");
      return res.status(500).json({ error: "Erro no retorno do Mercado Pago", data });
    }

    paymentStatusMap[data.id] = { status: "pending", rowData: { nome, whatsapp, servico, diaagendado, horaagendada, precoTotal } };

    // Retorna init_point para abrir na mesma aba
    return res.json({ init_point: data.init_point, paymentId: data.id });
  } catch (err) {
    console.error("❌ Erro ao gerar pagamento:", err);
    return res.status(500).json({ error: err.message });
  }
});

// REDIRECIONAMENTO PARA SUCESSO
app.get("/redirect-sucesso", async (req, res) => {
  const paymentId = req.query.preference_id || req.query.payment_id;
  const record = paymentStatusMap[paymentId];

  console.log("🔔 Redirect sucesso chamado para paymentId:", paymentId, "record:", record);

  if (!record) {
    return res.redirect("https://ciliosdabea.netlify.app/erro.html");
  }

  // Verifica status real no Mercado Pago
  try {
    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    const paymentData = await paymentRes.json();

    if (paymentData.status !== "approved") {
      console.warn("⚠️ Pagamento ainda não aprovado:", paymentData.status);
      return res.redirect("https://ciliosdabea.netlify.app/erro.html");
    }

    const metadata = paymentData.metadata || {};
    const query = new URLSearchParams({
      nome: metadata.nome || "",
      servico: metadata.servico || "",
      diaagendado: metadata.diaagendado || "",
      horaagendada: metadata.horaagendada || "",
      whatsapp: metadata.whatsapp || "",
    }).toString();

    // Atualiza status
    paymentStatusMap[paymentId].status = "approved";

    // Envia para Google Script
    await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...record.rowData, status: "Aprovado", transaction_id: paymentData.id }),
    });

    return res.redirect(`https://ciliosdabea.netlify.app/sucesso.html?${query}`);

  } catch (err) {
    console.error("❌ Erro no redirect-sucesso:", err);
    return res.redirect("https://ciliosdabea.netlify.app/erro.html");
  }
});

// STATUS DE PAGAMENTO (opcional)
app.get("/status-pagamento", (req, res) => {
  const { paymentId } = req.query;
  if (!paymentId) return res.status(400).json({ ok: false, msg: "paymentId necessário" });
  const record = paymentStatusMap[paymentId];
  res.json({ status: record?.status || "pending", rowData: record?.rowData });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
