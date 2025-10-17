import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const BACKEND_URL = process.env.BACKEND_URL;

// === Gerar pagamento ===
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const data = req.body;

    // Corrige a data para DD/MM/YYYY
    const [year, month, day] = data.diaagendado.split("-");
    data.diaagendado = `${day}/${month}/${year}`;
    const precoTotal = Number(data.precoTotal);
    if (isNaN(precoTotal)) throw new Error("Preço inválido");

    // Cria preferência Mercado Pago
    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        items: [{ title: data.servico, quantity: 1, unit_price: precoTotal }],
        metadata: data,
        back_urls: {
          success: "https://ciliosdabea.netlify.app/aguardando.html",
          failure: "https://ciliosdabea.netlify.app/aguardando.html",
          pending: "https://ciliosdabea.netlify.app/aguardando.html"
        },
        notification_url: `${BACKEND_URL}/webhook`
      })
    });

    const prefJson = await mpRes.json();
    if (!prefJson.init_point) throw new Error("Erro ao gerar checkout MP");

    // Retorna a URL do checkout para abrir em nova aba
    res.json({ init_point: prefJson.init_point });

  } catch (err) {
    console.error("Erro em /gerar-pagamento:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// === Webhook Mercado Pago ===
app.post("/webhook", async (req, res) => {
  try {
    const paymentId = req.body.data?.id;
    if (!paymentId) return res.status(200).send("Evento ignorado");

    const payment = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    }).then(r => r.json());

    if (payment.status === "approved") {
      const data = {
        nome: payment.metadata.nome,
        whatsapp: payment.metadata.whatsapp,
        servico: payment.metadata.servico,
        diaagendado: payment.metadata.diaagendado,
        horaagendada: payment.metadata.horaagendada,
        status: "Aprovado",
        pago: true
      };

      // Envia para Google Script
      await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });

      console.log("✅ Pagamento aprovado e enviado para Google Script", data);
      res.status(200).send("OK");
    } else {
      res.status(200).send("Evento ignorado");
    }

  } catch (e) {
    console.error("Erro webhook:", e);
    res.status(500).send("Erro");
  }
});

// === Horários bloqueados ===
app.get("/horarios-bloqueados", async (req, res) => {
  try {
    const gsRes = await fetch(GOOGLE_SCRIPT_URL, { method: "GET" });
    const data = await gsRes.json().catch(() => []);
    res.json(data);
  } catch (err) {
    console.error("Erro /horarios-bloqueados:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
