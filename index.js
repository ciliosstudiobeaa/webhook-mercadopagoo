import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

// === ROTA PARA GERAR PAGAMENTO ===
app.post("/gerar-pagamento", async (req, res) => {
  try {
    console.log("📦 [REQ] Dados recebidos para gerar pagamento:", req.body);

    const data = req.body;

    // Simulação de criação de pagamento Mercado Pago
    console.log("💰 Simulando criação de pagamento Mercado Pago...");
    const init_point = "https://www.mercadopago.com.br/checkout/v1/redirect";

    console.log("✅ Checkout gerado com sucesso:", init_point);
    return res.json({ init_point });
  } catch (err) {
    console.error("❌ ERRO EM /gerar-pagamento:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// === ROTA PARA HORÁRIOS BLOQUEADOS ===
app.get("/horarios-bloqueados", async (req, res) => {
  try {
    console.log("🔍 Buscando horários bloqueados no Google Script...");
    const gsRes = await fetch(GOOGLE_SCRIPT_URL, { method: "GET" });
    console.log("📡 [RES] Status do Google Script:", gsRes.status);
    const data = await gsRes.json().catch(() => []);
    console.log("📅 [RES] Horários recebidos:", data);
    res.json(data);
  } catch (err) {
    console.error("❌ ERRO EM /horarios-bloqueados:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// === WEBHOOK DO MERCADO PAGO ===
// Recebe notificações de pagamento aprovadas
app.post("/webhook", async (req, res) => {
  try {
    console.log("🔔 [WEBHOOK] Dados recebidos do MP:", req.body);

    const { topic, data } = req.body;

    if (topic !== "payment") {
      console.log("⚠️ Webhook ignorado: não é pagamento");
      return res.status(200).send("Ignorado");
    }

    const paymentId = data?.id;
    if (!paymentId) {
      console.error("❌ Webhook sem paymentId");
      return res.status(400).send("Sem paymentId");
    }

    // Consulta pagamento no MP
    const mpRes = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      }
    );
    const mpJson = await mpRes.json();
    console.log("📄 [MP] Dados do pagamento:", mpJson);

    // Só processa se aprovado
    if (mpJson.status !== "approved") {
      console.log("⚠️ Pagamento não aprovado, não envia para planilha");
      return res.status(200).send("Pagamento não aprovado");
    }

    // Aqui você envia para o Google Script
    const payload = {
      nome: mpJson.additional_info?.payer?.first_name || "Cliente",
      whatsapp: mpJson.additional_info?.payer?.phone?.number || "",
      servico: mpJson.metadata?.servico || "Desconhecido",
      precoTotal: mpJson.transaction_amount,
      diaagendado: mpJson.metadata?.diaagendado || "",
      horaagendada: mpJson.metadata?.horaagendada || "",
      status: "Aprovado",
    };

    console.log("🚀 Enviando para Google Script:", payload);

    const gsRes = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const gsJson = await gsRes.json();
    console.log("📄 [GS] Retorno Google Script:", gsJson);

    res.status(200).send("Pagamento processado");
  } catch (err) {
    console.error("❌ ERRO EM /webhook:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// === SERVIDOR ONLINE ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
