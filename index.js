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
    const data = await response.json(); // retorna [{diaagendado, horaagendada, status}]
    const approved = data.filter(x => x.status === "Aprovado");
    res.json(approved);
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
    // === Corrigido: back_urls válidas para evitar erro auto_return ===
    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        items: [
          { title: servico, quantity: 1, unit_price: parseFloat(precoTotal) },
        ],
        back_urls: {
          success: "https://seusite.com/sucesso",
          pending: "https://seusite.com/pendente",
          failure: "https://seusite.com/falha"
        },
        auto_return: "approved",
        external_reference: JSON.stringify({ diaagendado, horaagendada, whatsapp }),
        description: servico
      }),
    });

    const mpJson = await mpRes.json();

    if (!mpJson.init_point) {
      return res.status(500).json({ error: "Erro ao gerar pagamento MP", mpJson });
    }

    res.json({ init_point: mpJson.init_point });
  } catch (e) {
    console.error("Erro ao gerar pagamento:", e);
    res.status(500).json({ error: "Erro interno" });
  }
});

// === ROTA DE WEBHOOK PARA PAGAMENTO APROVADO ===
app.post("/webhook-mp", async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === "payment") {
      const paymentId = data.id;

      // Busca o pagamento no Mercado Pago
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      });
      const mpData = await mpRes.json();

      if (mpData.status === "approved") {
        // Atualiza a planilha apenas se aprovado
        let externalRef = {};
        try { externalRef = JSON.parse(mpData.external_reference); } catch {}
        await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nome: mpData.additional_info?.payer?.first_name || "",
            whatsapp: externalRef.whatsapp || "",
            servico: mpData.description || "",
            precoTotal: mpData.transaction_amount || 0,
            diaagendado: externalRef.diaagendado || "",
            horaagendada: externalRef.horaagendada || "",
            status: "Aprovado",
          }),
        });
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro webhook MP:", err);
    res.sendStatus(500);
  }
});

// === START SERVER ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
