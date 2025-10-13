import express from "express";
import fetch from "node-fetch";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL;
const BASE_URL = process.env.BASE_URL || "https://seu-backend.onrender.com"; // 🔹 ajuste para sua URL Render real

// Função utilitária: converter data ISO em formato BR
function isoToBR(isoDate) {
  if (!isoDate) return "";
  const [ano, mes, dia] = isoDate.split("-");
  return `${dia}/${mes}/${ano}`;
}

// Função utilitária: montar mensagem WhatsApp
function buildWhatsAppLink({ nome, servico, diaBr, hora }) {
  const mensagem = `Olá ${nome}! 😊%0ASeu agendamento para *${servico}* está confirmado.%0A🗓️ Data: ${diaBr}%0A🕒 Horário: ${hora}%0A%0AObrigada por agendar com a Cílios da Bea 💖`;
  return `https://wa.me/55${process.env.WHATSAPP_NUMBER}?text=${mensagem}`;
}

// ==============================
// 🔹 Rota para gerar pagamento
// ==============================
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;
    console.log("Recebido /gerar-pagamento:", req.body);

    if (!nome || !servico || !precoTotal)
      return res.status(400).json({ ok: false, msg: "Campos obrigatórios ausentes." });

    const preference = {
      items: [
        {
          title: servico,
          quantity: 1,
          unit_price: Number(precoTotal),
        },
      ],
      metadata: { nome, whatsapp, servico, diaagendado, horaagendada },
      back_urls: {
        success: `${BASE_URL}/sucesso`,
        failure: `${BASE_URL}/erro`,
        pending: `${BASE_URL}/aguardando`,
      },
      auto_return: "approved",
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(preference),
    });

    const mpData = await mpRes.json();

    if (!mpRes.ok) {
      console.error("Erro ao criar preferência:", mpData);
      return res.status(400).json({ ok: false, msg: "Erro ao gerar pagamento", erro: mpData });
    }

    // Registrar tentativa na planilha
    await fetch(GOOGLE_SHEET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome,
        diaagendado,
        horaagendada,
        servico,
        valor30: precoTotal,
        status: "pendente",
        whatsapp,
      }),
    });

    console.log("💾 Adicionado na planilha (pendente)");

    res.json({ ok: true, init_point: mpData.init_point });
  } catch (err) {
    console.error("Erro /gerar-pagamento:", err);
    res.status(500).json({ ok: false, msg: "Erro interno", erro: err.message });
  }
});

// ==============================
// 🔹 Webhook Mercado Pago
// ==============================
app.post("/webhook", async (req, res) => {
  try {
    const data = req.body;
    console.log("Webhook recebido:", data);

    if (data.type !== "payment") return res.sendStatus(200);

    const id = data.data.id;
    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    const payment = await paymentRes.json();

    console.log("Webhook pagamento:", payment.status);

    if (payment.status === "approved") {
      const meta = payment.metadata || {};
      const diaBr = isoToBR(meta.diaagendada || meta.diaagendado);
      const hora = meta.horaagendada || "";
      const nome = meta.nome || "";
      const servico = meta.servico || "";
      const whatsapp = meta.whatsapp || "";

      await fetch(GOOGLE_SHEET_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome,
          diaagendado: diaBr,
          horaagendada: hora,
          servico,
          valor30: payment.transaction_amount,
          status: "Aprovado",
          whatsapp,
          transaction_id: payment.id,
          reference: payment.external_reference || "",
        }),
      });

      console.log("✅ Pagamento aprovado e salvo na planilha");
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook:", err);
    res.sendStatus(500);
  }
});

// ==============================
// 🔹 Rota de sucesso (redireciona pro WhatsApp)
// ==============================
app.get("/sucesso", async (req, res) => {
  try {
    const paymentId = req.query.payment_id;
    if (!paymentId) return res.send("Pagamento processado, mas ID ausente.");

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });

    const payment = await mpRes.json();
    if (payment.status !== "approved") {
      return res.send("<h2>Pagamento ainda não aprovado, aguarde um instante...</h2>");
    }

    const meta = payment.metadata || {};
    const diaBr = isoToBR(meta.diaagendada || meta.diaagendado);
    const hora = meta.horaagendada || "";
    const nome = meta.nome || "";
    const servico = meta.servico || "";
    const waLink = buildWhatsAppLink({ nome, servico, diaBr, hora });

    return res.send(`
      <html>
        <head><meta charset="utf-8" /><title>Pagamento Aprovado!</title></head>
        <body style="font-family:sans-serif;text-align:center;padding-top:50px;">
          <h2>✅ Pagamento confirmado, ${nome}!</h2>
          <p>Redirecionando você para o WhatsApp...</p>
          <script>
            setTimeout(() => { window.location.href = "${waLink}"; }, 1500);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Erro /sucesso:", err);
    res.status(500).send("Erro ao processar redirecionamento.");
  }
});

// ==============================
app.listen(PORT, () => console.log(`🔥 Servidor rodando na porta ${PORT}`));
