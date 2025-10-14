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

// === TOKENS TEMPORÁRIOS PARA SUCESSO.HTML ===
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

    if (!nome || !whatsapp || !servico || !precoTotal || !diaagendado || !horaagendada) {
      return res.status(400).json({ error: "Todos os campos são obrigatórios" });
    }

    // === FORMATA DATA PARA BR ===
    const [ano, mes, dia] = diaagendado.split("-");
    const dataBr = `${dia}/${mes}/${ano}`;

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
      metadata: { nome, whatsapp, servico, diaagendado: dataBr, horaagendada },
      back_urls: { success: "", failure: "" },
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
    console.log("✅ Retorno completo Mercado Pago:", data);

    if (!data.init_point) {
      console.error("❌ init_point não retornado:", data);
      return res.status(500).json({ error: "Não foi possível criar preferência", data });
    }

    // === ENVIA PARA PLANILHA COMO PENDENTE ===
    const rowData = {
      nome,
      diaagendado: dataBr,
      horaagendada,
      servico,
      valor30: parseFloat(precoTotal * 0.3),
      status: "Pendente",
      whatsapp,
    };

    const gRes = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rowData),
    });
    const gData = await gRes.text();
    console.log("📤 Retorno do Google Script:", gData);

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
    console.log(`🔎 Status do pagamento ${paymentId}:`, paymentData.status);

    if (paymentData.status === "approved") {
      const metadata = paymentData.metadata || {};

      // === DATA NO FORMATO BR ===
      const diaag = metadata.diaagendado || "";
      const horaag = metadata.horaagendada || "";

      // === CRIA TOKEN ALEATÓRIO PARA SUCESSO.HTML ===
      const token = crypto.randomBytes(16).toString("hex");
      validTokens[token] = { ...metadata, createdAt: Date.now() };

      // === ATUALIZA PLANILHA COMO APROVADO ===
      const rowData = {
        nome: metadata.nome || "Desconhecido",
        diaagendado: diaag,
        horaagendada: horaag,
        servico: metadata.servico || "",
        valor30: paymentData.transaction_amount || "",
        status: "Aprovado",
        whatsapp: metadata.whatsapp || "",
        transaction_id: paymentData.transaction_details?.transaction_id || paymentData.id || "",
        reference: "MP-" + paymentId,
      };

      await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rowData),
      });

      console.log("✅ Pagamento aprovado! Token gerado:", token);
      return res.status(200).json({ ok: true, successUrl: `https://seudominio.com/sucesso.html?token=${token}` });
    }

    return res.status(200).json({ ok: false, msg: "Pagamento não aprovado" });
  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// === VALIDAR TOKEN (usado pelo sucesso.html) ===
app.post("/validate-token", (req, res) => {
  const { token } = req.body;
  if (!token || !validTokens[token]) return res.json({ valid: false });

  const data = validTokens[token];
  // expira após 5 minutos
  if (Date.now() - data.createdAt > 5 * 60 * 1000) {
    delete validTokens[token];
    return res.json({ valid: false });
  }

  delete validTokens[token]; // invalida após uso
  return res.json({ valid: true, data });
});

// === INICIALIZA SERVIDOR ===
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
