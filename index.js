import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// === VARIÁVEIS DE AMBIENTE ===
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

// === ROTA DE TESTE ===
app.get("/", (req, res) => {
  res.send("Servidor ativo — Mercado Pago + WhatsApp redirecionamento!");
});

// === GERAR PAGAMENTO ===
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;
    console.log("📦 Dados recebidos:", req.body);

    const body = {
      items: [
        {
          title: `Sinal de agendamento - ${servico}`,
          quantity: 1,
          currency_id: "BRL",
          unit_price: parseFloat(precoTotal * 0.3),
        },
      ],
      payer: {
        name: nome,
        email: `${whatsapp}@ciliosdabea.fake`,
      },
      metadata: { nome, whatsapp, servico, diaagendado, horaagendada },
      back_urls: {
        success: `https://seu-site.netlify.app/sucesso.html?nome=${encodeURIComponent(nome)}&whatsapp=${whatsapp}&servico=${encodeURIComponent(servico)}&diaagendado=${diaagendado}&horaagendada=${horaagendada}`,
        failure: `https://seu-site.netlify.app/erro.html`,
      },
      auto_return: "approved",
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await mpRes.json();

    if (!data.init_point) {
      console.error("❌ init_point não retornado:", data);
      return res.status(500).json({ error: "Erro ao gerar pagamento", details: data });
    }

    console.log("✅ Preferência criada:", data.init_point);
    return res.json({ init_point: data.init_point });
  } catch (err) {
    console.error("❌ Erro ao gerar pagamento:", err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
