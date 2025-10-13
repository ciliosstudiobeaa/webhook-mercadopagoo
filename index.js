// server.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const WHATSAPP_BEA = process.env.WHATSAPP_BEA || "";

if (!MP_ACCESS_TOKEN) console.warn("⚠️ MP_ACCESS_TOKEN não definido em env.");
if (!GOOGLE_SCRIPT_URL) console.warn("⚠️ GOOGLE_SCRIPT_URL não definido em env.");
if (!WHATSAPP_BEA) console.warn("⚠️ WHATSAPP_BEA não definido em env.");

// Em memória
let agendamentos = [];

// --- Helpers ---
function isoToBR(isoDate) {
  if (!isoDate) return "";
  try {
    const d = new Date(isoDate);
    if (!isNaN(d)) return d.toLocaleDateString("pt-BR");
    const [y, m, day] = isoDate.split("-");
    if (day) return `${day}/${m}/${y}`;
    return isoDate;
  } catch {
    return isoDate;
  }
}

function buildWhatsAppLink({ nome, servico, diaBr, hora }) {
  const mensagem = `Oi Bea! 💅%0A%0ANovo agendamento confirmado:%0A👤 Cliente: ${encodeURIComponent(
    nome
  )}%0A📅 Data: ${encodeURIComponent(diaBr)}%0A⏰ Horário: ${encodeURIComponent(
    hora
  )}%0A💆 Serviço: ${encodeURIComponent(servico)}`;
  return `https://wa.me/${WHATSAPP_BEA}?text=${mensagem}`;
}

async function postToGoogleScript(payload, tries = 2) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      return { ok: res.ok, json, status: res.status };
    } catch (err) {
      console.error(`Erro ao postar no Google Script (tentativa ${attempt}):`, err.message);
      if (attempt === tries) throw err;
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
}

// --- Endpoints ---
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;
    if (!nome || !servico || precoTotal == null || !diaagendado || !horaagendada) {
      return res.status(400).json({ ok: false, msg: "Campos obrigatórios ausentes" });
    }

    // Preference Mercado Pago
    const preference = {
      items: [{ title: servico, quantity: 1, unit_price: parseFloat(precoTotal) }],
      payer: { name: nome },
      metadata: { nome, whatsapp, servico, diaagendado, horaagendada },
      back_urls: {
        success: "https://seusite.com/sucesso",
        failure: "https://seusite.com/falha",
        pending: "https://seusite.com/pendente"
      },
      auto_return: "approved",
      external_reference: `${nome}-${Date.now()}`
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(preference),
    });

    const mpJson = await mpRes.json();

    if (!mpJson.init_point) {
      console.error("Erro ao criar preferência MP:", mpJson);
      return res.status(500).json({ ok: false, msg: "Erro ao gerar link de pagamento" });
    }

    const diaBr = isoToBR(diaagendado);
    const whatsapp_prefill = buildWhatsAppLink({ nome, servico, diaBr, hora: horaagendada });

    return res.json({ ok: true, init_point: mpJson.init_point, whatsapp_prefill });
  } catch (err) {
    console.error("Erro /gerar-pagamento:", err);
    return res.status(500).json({ ok: false, msg: err.message });
  }
});

// Webhook Mercado Pago
app.post("/webhook", async (req, res) => {
  try {
    const paymentId = req.body?.data?.id;
    if (!paymentId) return res.status(400).json({ ok: false, msg: "paymentId ausente" });

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    const payment = await mpRes.json();

    if (payment.status === "approved") {
      const meta = payment.metadata || {};
      const diaBr = isoToBR(meta.diaagendado);
      const hora = meta.horaagendada;
      const agendamento = {
        nome: meta.nome,
        servico: meta.servico,
        diaagendado: diaBr,
        horaagendada: hora,
        whatsapp: meta.whatsapp,
        status: "Aprovado",
        transaction_id: payment.id,
        reference: payment.external_reference
      };

      await postToGoogleScript(agendamento, 3);
      agendamentos.push({ data: meta.diaagendado, horario: hora, servico: meta.servico, nome: meta.nome });

      const waLink = buildWhatsAppLink({ nome: meta.nome, servico: meta.servico, diaBr, hora });
      return res.status(200).json({ ok: true, msg: "Pagamento aprovado e processado", whatsapp_link: waLink });
    }

    return res.status(200).json({ ok: false, msg: `Pagamento ${payment.status}` });
  } catch (err) {
    console.error("Erro no webhook:", err);
    return res.status(500).json({ ok: false, msg: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
