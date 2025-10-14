import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
app.use(cors());
app.use(express.json());

// === VARIÁVEIS DE AMBIENTE ===
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

// Tokens válidos temporários
let validTokens = {};

// === ROTA DE TESTE ===
app.get("/", (req, res) => {
  res.send("Servidor ativo — Mercado Pago + Google Sheets rodando!");
});

// === GERAR PAGAMENTO ===
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;
    console.log("📦 Dados recebidos para pagamento:", req.body);

    // Gerar token aleatório
    const token = crypto.randomBytes(16).toString("hex");
    validTokens[token] = { nome, whatsapp, servico, diaagendado, horaagendada, createdAt: Date.now() };

    const body = {
      items: [
        {
          title: `Sinal de agendamento - ${servico}`,
          quantity: 1,
          currency_id: "BRL",
          unit_price: Number(precoTotal) * 0.3,
        },
      ],
      payer: {
        name: nome,
        email: `${whatsapp}@ciliosdabea.fake`,
      },
      metadata: { nome, whatsapp, servico, diaagendado, horaagendada, token },
      back_urls: {
        success: `https://ciliosdabea.netlify.app/aguardando.html?token=${token}`, 
        failure: `https://ciliosdabea.netlify.app/erro.html`,
      },
      auto_return: "approved", // funciona só para cartão/saldo
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await mpRes.json();
    if (!data.init_point) {
      console.error("❌ init_point não retornado:", data);
      return res.status(500).json({ error: "Erro ao gerar pagamento no Mercado Pago", details: data });
    }

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
    if (!paymentId) return res.status(200).json({ ok: false, msg: "Sem paymentId" });

    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    const paymentData = await paymentRes.json();
    console.log("🔎 Status do pagamento:", paymentData.status);

    if (["approved", "authorized"].includes(paymentData.status)) { 
      const metadata = paymentData.metadata || {};
      const token = metadata.token;
      const [ano, mes, dia] = metadata.diaagendado?.split("-") || [];
      const dataBR = dia && mes && ano ? `${dia}/${mes}/${ano}` : metadata.diaagendado || "";

      const rowData = {
        nome: metadata.nome || "Desconhecido",
        diaagendado: dataBR,
        horaagendada: metadata.horaagendada || "",
        servico: metadata.servico || "",
        valor30: paymentData.transaction_amount || "",
        status: "Aprovado",
        whatsapp: metadata.whatsapp || "",
        transaction_id: paymentData.transaction_details?.transaction_id || paymentData.id || "",
        reference: "MP-" + paymentId,
      };

      // Enviar para Google Sheets
      await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rowData),
      });

      // Enviar WhatsApp automaticamente (exemplo via API externa)
      try {
        const msg = `Olá ${metadata.nome}! Seu agendamento para ${metadata.servico} em ${dataBR} às ${metadata.horaagendada} foi confirmado! 💅✨`;
        await fetch("https://api.seuservidorwhatsapp.com/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: metadata.whatsapp, message: msg })
        });
        console.log("📲 WhatsApp enviado!");
      } catch (err) {
        console.error("❌ Erro ao enviar WhatsApp:", err);
      }

      return res.status(200).json({ ok: true, token });
    }

    return res.status(200).json({ ok: false, msg: "Pagamento não aprovado" });

  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// === VALIDAR TOKEN PARA SUCESSO/AGUARDANDO ===
app.post("/validate-token", (req, res) => {
  const { token } = req.body;
  if (!token || !validTokens[token]) return res.json({ valid: false });

  const data = validTokens[token];
  if (Date.now() - data.createdAt > 5 * 60 * 1000) {
    delete validTokens[token];
    return res.json({ valid: false });
  }

  delete validTokens[token]; 
  return res.json({ valid: true, data });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
