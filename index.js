import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
app.use(cors());
app.use(express.json());

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

// Tokens válidos temporários
let validTokens = {};

// === ROTA DE TESTE ===
app.get("/", (req, res) => {
  console.log("⚡ GET / chamado");
  res.send("Servidor ativo — Mercado Pago + Google Sheets rodando!");
});

// === GERAR PAGAMENTO ===
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;
    console.log("📦 Dados recebidos para pagamento:", req.body);

    const body = {
      items: [
        { title: `Sinal de agendamento - ${servico}`, quantity: 1, currency_id: "BRL", unit_price: parseFloat(precoTotal * 0.3) },
      ],
      payer: { name: nome, email: `${whatsapp}@ciliosdabea.fake` },
      metadata: { nome, whatsapp, servico, diaagendado, horaagendada },
      back_urls: { success: "", failure: "" },
      auto_return: "approved",
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await mpRes.json();
    console.log("✅ Preferência criada no Mercado Pago:", data.id);
    return res.json({ init_point: data.init_point });

  } catch (err) {
    console.error("❌ Erro ao gerar pagamento:", err);
    return res.status(500).json({ error: err.message });
  }
});

// === WEBHOOK MERCADO PAGO ===
app.post("/webhook", async (req, res) => {
  try {
    console.log("📩 Webhook recebido:", JSON.stringify(req.body));

    const paymentId = req.body?.data?.id;
    if (!paymentId) {
      console.warn("⚠️ Webhook sem paymentId");
      return res.status(200).json({ ok: false, msg: "Sem paymentId" });
    }

    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    const paymentData = await paymentRes.json();

    console.log(`🔎 Status do pagamento ${paymentId}:`, paymentData.status);

    if (paymentData.status === "approved") {
      const metadata = paymentData.metadata || {};
      console.log("✅ Pagamento aprovado! Metadata:", metadata);

      // Criar token aleatório
      const token = crypto.randomBytes(16).toString("hex");
      validTokens[token] = { ...metadata, createdAt: Date.now() };
      console.log("🔑 Token gerado:", token);

      // Envia para Google Script
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

      const gRes = await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rowData),
      });

      const gData = await gRes.text();
      console.log("📤 Retorno do Google Script:", gData);

      // Retorna link de sucesso com token
      const successUrl = `https://seudominio.com/sucesso.html?token=${token}`;
      console.log("🌐 Success URL gerada:", successUrl);
      return res.status(200).json({ ok: true, successUrl });
    }

    console.log("⚠️ Pagamento não aprovado");
    return res.status(200).json({ ok: false, msg: "Pagamento não aprovado" });

  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// === VALIDAR TOKEN ===
app.post("/validate-token", (req, res) => {
  const { token } = req.body;
  console.log("🔍 Validando token:", token);

  if (!token || !validTokens[token]) {
    console.warn("❌ Token inválido ou não encontrado");
    return res.json({ valid: false });
  }

  const data = validTokens[token];
  if (Date.now() - data.createdAt > 5 * 60 * 1000) {
    console.warn("⚠️ Token expirado");
    delete validTokens[token];
    return res.json({ valid: false });
  }

  delete validTokens[token]; // invalida após uso
  console.log("✅ Token válido:", data);
  return res.json({ valid: true, data });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
