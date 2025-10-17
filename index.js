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

    // Corrige a data para o formato DD/MM/YYYY
    const [year, month, day] = data.diaagendado.split("-");
    const diaagendado = `${day}/${month}/${year}`;
    data.diaagendado = diaagendado;

    // Cria preferência no Mercado Pago
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
          nome: data.nome,
          whatsapp: data.whatsapp,
          servico: data.servico,
          diaagendado: data.diaagendado,
          horaagendada: data.horaagendada
        },
        back_urls: { success: "", failure: "", pending: "" },
        notification_url: `${process.env.BACKEND_URL}/webhook-mercadopago`
      }),
    });

    const prefJson = await mpRes.json();
    if(!prefJson.init_point) throw new Error("Erro ao gerar checkout MP");

    console.log("✅ Checkout gerado com sucesso:", prefJson.init_point);
    res.json({ init_point: prefJson.init_point });
  } catch (err) {
    console.error("❌ ERRO EM /gerar-pagamento:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// === WEBHOOK MERCADO PAGO ===
app.post("/webhook", async (req, res) => {
  try {
    console.log("📢 [Webhook] Recebido evento:", req.body);

    const payment = req.body.data?.id ? await fetch(`https://api.mercadopago.com/v1/payments/${req.body.data.id}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    }).then(r => r.json()) : null;

    if(payment && payment.status === "approved"){
      console.log("✅ Pagamento aprovado, enviando para Google Script...");

      const data = {
        nome: payment.metadata.nome,
        whatsapp: payment.metadata.whatsapp,
        servico: payment.metadata.servico,
        diaagendado: payment.metadata.diaagendado,
        horaagendada: payment.metadata.horaagendada,
        status: "Aprovado",
        pago: true
      };

      const gsRes = await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });

      const gsJson = await gsRes.json().catch(() => ({}));
      console.log("📄 [GS] Retorno:", gsJson);

      res.status(200).send("OK");
    } else {
      console.log("ℹ️ Pagamento ainda não aprovado");
      res.status(200).send("Evento ignorado");
    }
  } catch(e) {
    console.error("❌ ERRO WEBHOOK:", e);
    res.status(500).send("Erro");
  }
});

// === ROTA PARA BUSCAR HORÁRIOS BLOQUEADOS ===
app.get("/horarios-bloqueados", async (req, res) => {
  try {
    console.log("🔍 Buscando horários bloqueados no Google Script...");
    const gsRes = await fetch(GOOGLE_SCRIPT_URL, { method: "GET" });
    const data = await gsRes.json().catch(() => []);
    res.json(data);
  } catch (err) {
    console.error("❌ ERRO EM /horarios-bloqueados:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// === SERVIDOR ONLINE ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
