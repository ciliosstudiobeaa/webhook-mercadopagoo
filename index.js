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

    // Envio para o Google Script
    console.log("🚀 Enviando dados para o Google Script...");
    const gsRes = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, status: "Aprovado" }),
    });

    console.log("📡 [RES] Status do Google Script:", gsRes.status);

    const gsJson = await gsRes.json().catch(() => ({}));
    console.log("📄 [RES] Retorno do Google Script:", gsJson);

    if (!gsJson.ok && !gsJson.success) {
      throw new Error(gsJson.msg || "Erro ao enviar dados ao Google Script");
    }

    // Simulação de criação de pagamento
    console.log("💰 Simulando criação de pagamento Mercado Pago...");
    const init_point =
      "https://www.mercadopago.com.br/checkout/v1/redirect";

    console.log("✅ Checkout gerado com sucesso:", init_point);
    return res.json({ init_point });

  } catch (err) {
    console.error("❌ ERRO EM /gerar-pagamento:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// === ROTA PARA BUSCAR HORÁRIOS BLOQUEADOS ===
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

// === SERVIDOR ONLINE ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
