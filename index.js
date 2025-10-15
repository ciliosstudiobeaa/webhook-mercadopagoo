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
  console.log("[INFO] Servidor ativo");
  res.send("Servidor ativo — integração Mercado Pago + Google Sheets rodando!");
});

// GERAR PAGAMENTO
app.post("/gerar-pagamento", async (req, res) => {
  try {
    console.log("[INFO] Recebendo request de pagamento:", req.body);
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;

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

    console.log("[INFO] Enviando para Mercado Pago:", body);
    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await mpRes.json();
    console.log("[INFO] Resposta Mercado Pago:", data);

    if(!data.init_point){
      console.error("[ERRO] Mercado Pago não retornou init_point");
      return res.status(500).json({ error: "Erro ao gerar checkout" });
    }

    paymentStatusMap[data.id] = { status: "pending", rowData: { nome, whatsapp, servico, diaagendado, horaagendada, precoTotal } };
    return res.json({ init_point: data.init_point, paymentId: data.id });

  } catch (err) {
    console.error("[ERRO] Ao gerar pagamento:", err);
    return res.status(500).json({ error: err.message });
  }
});

// WEBHOOK MERCADO PAGO
app.post("/webhook", async (req, res) => {
  try {
    console.log("[INFO] Webhook recebido:", req.body);
    const paymentId = req.body?.data?.id;
    if (!paymentId) {
      console.warn("[WARN] Webhook sem paymentId");
      return res.status(200).json({ ok: false, msg: "Sem paymentId" });
    }

    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });

    const paymentData = await paymentRes.json();
    console.log("[INFO] Dados do pagamento Mercado Pago:", paymentData);

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

      console.log("[INFO] Enviando dados para Google Sheets:", rowData);
      try {
        const gsRes = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rowData),
        });
        console.log("[INFO] Google Script respondeu:", await gsRes.text());
      } catch (err) {
        console.error("[ERRO] Ao enviar para Google Script:", err);
      }

      paymentStatusMap[paymentId] = { status: "approved", rowData };
    } else {
      console.log(`[INFO] Pagamento ${paymentId} ainda não aprovado. Status atual: ${status}`);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[ERRO] Webhook:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// REDIRECIONAMENTO SUCESSO
app.get("/redirect-sucesso", (req, res) => {
  const paymentId = req.query.preference_id || req.query.payment_id;
  console.log("[INFO] Redirect sucesso chamado para paymentId:", paymentId);

  const record = paymentStatusMap[paymentId];
  if (!record || record.status !== "approved") {
    console.warn("[WARN] Pagamento não aprovado ou registro não encontrado");
    return res.redirect("https://ciliosdabea.netlify.app/erro.html");
  }

  const { nome, servico, diaagendado, horaagendada, whatsapp } = record.rowData;
  const query = new URLSearchParams({ nome, servico, diaagendado, horaagendada, whatsapp }).toString();
  console.log("[INFO] Redirecionando para sucesso.html com query:", query);
  return res.redirect(`https://ciliosdabea.netlify.app/sucesso.html?${query}`);
});

// STATUS DE PAGAMENTO (polling)
app.get("/status-pagamento", (req, res) => {
  const { paymentId } = req.query;
  if (!paymentId) {
    console.warn("[WARN] Status-pagamento sem paymentId");
    return res.status(400).json({ ok: false, msg: "paymentId necessário" });
  }

  const record = paymentStatusMap[paymentId];
  if (!record) return res.json({ status: "pending" });

  res.json({ status: record.status, rowData: record.rowData });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`[INFO] Servidor rodando na porta ${PORT}`));
