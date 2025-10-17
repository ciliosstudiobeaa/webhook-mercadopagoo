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
    const data = req.body;
    console.log("📦 Gerando pagamento:", data);

    // 🔹 Só cria preferência no Mercado Pago, não toca na planilha
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
          diaagendado: data.diaagendado,
          horaagendada: data.horaagendada,
          nome: data.nome,
          whatsapp: data.whatsapp
        },
        back_urls: { success: "", failure: "", pending: "" },
      }),
    });

    const prefJson = await mpRes.json();
    if (!prefJson.init_point) throw new Error("Erro ao gerar checkout MP");
    console.log("✅ Checkout gerado com sucesso:", prefJson.init_point);

    return res.json({ init_point: prefJson.init_point });

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
    const data = await gsRes.json().catch(() => []);
    console.log("📅 [RES] Horários recebidos:", data);
    res.json(data);
  } catch (err) {
    console.error("❌ ERRO EM /horarios-bloqueados:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// === ROTA DO WEBHOOK MERCADO PAGO ===
app.post("/webhook-mercadopago", async (req, res) => {
  try {
    const mpData = req.body;
    console.log("📬 Webhook recebido:", JSON.stringify(mpData, null, 2));

    // --- Extrair status e metadata de forma segura ---
    let status, metadata;
    if (mpData.type === "payment") {
      if(mpData.data?.status) {
        status = mpData.data.status;
        metadata = mpData.data.metadata || {};
      } else if(mpData.data?.id) {
        // Buscar detalhes via API se veio só ID
        const paymentId = mpData.data.id;
        const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
          headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
        });
        const paymentJson = await mpRes.json();
        status = paymentJson.status;
        metadata = paymentJson.metadata || {};
      }
    } else {
      console.log("⚠️ Webhook ignorado: type não é payment");
      return res.status(200).send("Webhook ignorado");
    }

    // --- Se aprovado, envia para Google Script ---
    if (status === "approved") {
      const { servico, diaagendado, horaagendada, nome, whatsapp } = metadata;
      console.log("✅ Pagamento aprovado. Enviando para Google Script...");

      const gsRes = await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          servico,
          diaagendado,
          horaagendada,
          nome,
          whatsapp,
          status: "Aprovado"
        }),
      });

      const gsJson = await gsRes.json().catch(() => ({}));
      console.log("📄 Retorno do Google Script:", gsJson);
    } else {
      console.log("⚠️ Pagamento ainda não aprovado:", status);
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ ERRO NO WEBHOOK:", err.message);
    res.status(500).send("Erro");
  }
});

// === SERVIDOR ONLINE ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
