import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// ✅ Variáveis de ambiente
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

if (!MP_ACCESS_TOKEN || !GOOGLE_SCRIPT_URL) {
  console.error("❌ Erro: variáveis de ambiente MP_ACCESS_TOKEN ou GOOGLE_SCRIPT_URL não configuradas.");
  process.exit(1);
}

// ✅ Função (simples) para verificar disponibilidade de horário
async function horarioDisponivel(diaagendado, horaagendada) {
  try {
    console.log("🔎 Verificando horários disponíveis...");
    const response = await fetch(GOOGLE_SCRIPT_URL);
    const text = await response.text();
    console.log("🧾 Resposta da planilha:", text);
    return true; // provisório: sempre disponível
  } catch (error) {
    console.error("⚠️ Erro ao verificar disponibilidade:", error);
    return false;
  }
}

// ✅ Endpoint principal: gerar pagamento
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;
    console.log("📩 Recebido /gerar-pagamento:", req.body);

    // Validação
    if (!nome || !servico || !precoTotal) {
      return res.status(400).json({ ok: false, error: "Campos obrigatórios ausentes." });
    }

    // Verifica disponibilidade
    await horarioDisponivel(diaagendado, horaagendada);

    // ✅ Cria preferência Mercado Pago
    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [
          {
            title: servico,
            quantity: 1,
            unit_price: Number(precoTotal), // 🔧 Garante número
            currency_id: "BRL",
          },
        ],
        payer: { name: nome },
        back_urls: {
          success: "https://example.com/success",
          failure: "https://example.com/failure",
        },
        auto_return: "approved",
        notification_url: GOOGLE_SCRIPT_URL,
        metadata: {
          nome,
          whatsapp,
          servico,
          diaagendado,
          horaagendada,
        },
      }),
    });

    const mpData = await mpResponse.json();
    console.log("💰 Preferência Mercado Pago criada:", mpData);

    if (!mpData.init_point) {
      throw new Error("⚠️ Erro: não foi possível gerar o link de checkout.");
    }

    // ✅ Retorna o link para o cliente
    res.json({
      ok: true,
      checkout_url: mpData.init_point,
    });
  } catch (err) {
    console.error("💥 Erro ao gerar pagamento:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(3000, () => console.log("🚀 Servidor rodando na porta 3000"));
