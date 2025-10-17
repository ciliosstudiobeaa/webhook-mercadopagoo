import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// === VARIÁVEIS DE AMBIENTE ===
// Defina no Render ou seu ambiente
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

// ============================
// Rota para gerar pagamento
// ============================
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;

    // 1️⃣ Enviar para Google Script
    const gsRes = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, whatsapp, servico, precoTotal, diaagendado, horaagendada, status: "Aguardando" })
    });
    const gsJson = await gsRes.json();
    if (!gsJson.ok) throw new Error(gsJson.msg || "Erro Google Script");

    // 2️⃣ Criar preferência no Mercado Pago
    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        items: [
          {
            title: servico,
            quantity: 1,
            unit_price: parseFloat(precoTotal)
          }
        ],
        back_urls: {
          success: "https://seu-frontend.com/aguardando.html",
          pending: "https://seu-frontend.com/aguardando.html",
          failure: "https://seu-frontend.com/erro.html"
        },
        auto_return: "approved"
      })
    });
    const mpJson = await mpRes.json();

    if (!mpJson.init_point) throw new Error("Erro ao gerar checkout Mercado Pago");

    // 3️⃣ Retorna init_point real
    res.json({ init_point: mpJson.init_point });

  } catch (err) {
    console.error("Erro /gerar-pagamento:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================
// Rota para buscar horários bloqueados
// ============================
app.get("/horarios-bloqueados", async (req, res) => {
  try {
    const gsRes = await fetch(GOOGLE_SCRIPT_URL, { method: "GET" });
    const data = await gsRes.json();
    // Ex: data = [{ dia: "2025-10-17", hora: "11:00" }, ...]
    res.json(data);
  } catch (err) {
    console.error("Erro /horarios-bloqueados:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================
// Inicia o servidor
// ============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
