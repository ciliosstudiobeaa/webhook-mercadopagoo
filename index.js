import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// === VARIÁVEIS DE AMBIENTE ===
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

// === ROTA PARA HORÁRIOS BLOQUEADOS ===
app.get("/horarios-bloqueados", async (req, res) => {
  try {
    const response = await fetch(GOOGLE_SCRIPT_URL);
    const data = await response.json(); // assume que o Google Script retorna [{diaagendado, horaagendada, status}]
    res.json(data);
  } catch (e) {
    console.error("Erro ao buscar horários:", e);
    res.status(500).json({ error: "Erro ao buscar horários" });
  }
});

// === ROTA PARA GERAR PAGAMENTO ===
app.post("/gerar-pagamento", async (req, res) => {
  const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;

  if (!nome || !whatsapp || !servico || !precoTotal || !diaagendado || !horaagendada) {
    return res.status(400).json({ error: "Campos obrigatórios faltando" });
  }

  try {
    // 1️⃣ Gerar pagamento no Mercado Pago
    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        items: [
          {
            title: servico,
            quantity: 1,
            unit_price: parseFloat(precoTotal),
          },
        ],
        back_urls: {
          success: "",
          pending: "",
          failure: "",
        },
        auto_return: "approved",
      }),
    });
    const mpJson = await mpRes.json();

    if (!mpJson.init_point) return res.status(500).json({ error: "Erro ao gerar pagamento MP", mpJson });

    // 2️⃣ Enviar para Google Sheets
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
        status: "Aguardando Pagamento",
      }),
    });

    res.json({ init_point: mpJson.init_point });
  } catch (e) {
    console.error("Erro ao gerar pagamento:", e);
    res.status(500).json({ error: "Erro interno" });
  }
});

// === START SERVER ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
