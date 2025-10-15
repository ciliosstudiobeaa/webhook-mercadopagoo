import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// 🔹 URLs fixas
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/SEU_LINK_DO_SCRIPT/exec";
const FRONT_URL = "https://seusite.com"; // muda pra URL do seu site hospedado

// 🔹 Endpoint de gerar pagamento
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;

    console.log("📦 Dados recebidos para pagamento:", req.body);

    const preferenceBody = {
      items: [
        {
          title: `${servico} - ${diaagendado} ${horaagendada}`,
          quantity: 1,
          currency_id: "BRL",
          unit_price: parseFloat(precoTotal),
        },
      ],
      back_urls: {
        success: `${FRONT_URL}/aguardando.html?status=approved`,
        pending: `${FRONT_URL}/aguardando.html?status=pending`,
        failure: `${FRONT_URL}/aguardando.html?status=failure`,
      },
      auto_return: "approved",
      notification_url: `${FRONT_URL}/notificacao`,
    };

    const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer SEU_TOKEN_MP`,
      },
      body: JSON.stringify(preferenceBody),
    });

    const json = await response.json();

    if (!json.init_point) throw new Error("Erro ao gerar checkout do Mercado Pago.");

    // envia pro Google Script
    await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome,
        whatsapp,
        servico,
        precoTotal,
        diaagendado,
        horaagendada,
        status: "pendente",
      }),
    });

    res.json({ init_point: json.init_point });
  } catch (err) {
    console.error("❌ Erro ao gerar pagamento:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 Endpoint para buscar agendamentos ocupados
app.get("/agendamentos", async (req, res) => {
  try {
    const response = await fetch(`${GOOGLE_SCRIPT_URL}?date=${req.query.date}`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("❌ Falha ao carregar agendamentos:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
