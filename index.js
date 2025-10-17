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

    // Corrige a data para DD/MM/YYYY
    const [year, month, day] = data.diaagendado.split('-');
    const diaCorrigido = `${day}/${month}/${year}`;

    // Cria preferência real no Mercado Pago
    console.log("💰 Criando preferência no Mercado Pago...");
    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        items: [
          {
            title: data.servico,
            quantity: 1,
            unit_price: data.precoTotal,
          },
        ],
        metadata: {
          servico: data.servico,
          diaagendado: diaCorrigido,
          horaagendada: data.horaagendada,
          nome: data.nome,
          whatsapp: data.whatsapp
        },
        back_urls: { success: "", failure: "", pending: "" },
      }),
    });

    const prefJson = await mpRes.json();
    console.log("📄 [MP] Preferência gerada:", prefJson);

    if (!prefJson.init_point) throw new Error("Erro ao gerar checkout MP");

    // Retorna init_point e paymentId pro front
    return res.json({ init_point: prefJson.init_point, paymentId: prefJson.id });
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

// === ROTA PARA CHECAR PAGAMENTO PELO PAYMENT ID ===
app.get("/check-payment/:id", async (req, res) => {
  try {
    const mpId = req.params.id;
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${mpId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    const mpJson = await mpRes.json();
    res.json({ status: mpJson.status });
  } catch (err) {
    console.error("❌ ERRO EM /check-payment/:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// === SERVIDOR ONLINE ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
