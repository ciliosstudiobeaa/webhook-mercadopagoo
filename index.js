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

    // ❌ Removido envio direto para a planilha
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
          diaagendado: data.diaagendado,
          horaagendada: data.horaagendada,
        },
        back_urls: { success: "", failure: "", pending: "" },
      }),
    });

    const prefJson = await mpRes.json();
    console.log("📄 [MP] Preferência gerada:", prefJson);

    if (!prefJson.init_point) throw new Error("Erro ao gerar checkout MP");

    console.log("✅ Checkout gerado com sucesso:", prefJson.init_point);
    return res.json({ init_point: prefJson.init_point });
  } catch (err) {
    console.error("❌ ERRO EM /gerar-pagamento:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// === ROTA DO WEBHOOK MERCADO PAGO ===
app.post("/mp-webhook", async (req, res) => {
  try {
    const { id, topic } = req.body;
    console.log("📬 [Webhook] Recebido:", req.body);

    if (topic === "payment") {
      // Busca o pagamento no MP
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      });
      const payment = await mpRes.json();

      console.log("💳 [MP] Dados do pagamento:", payment);

      if (payment.status === "approved") {
        console.log("✅ Pagamento aprovado! Enviando para a planilha...");
        await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            servico: payment.metadata.servico,
            diaagendado: payment.metadata.diaagendado,
            horaagendada: payment.metadata.horaagendada,
            status: "Aprovado",
          }),
        });
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ ERRO EM /mp-webhook:", err.message);
    res.status(500).send("Erro");
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
