// server.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIG ---
const PORT = process.env.PORT || 10000;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL; // ex: https://script.google.com/macros/s/xxx/exec
const WHATSAPP_BEA = process.env.WHATSAPP_BEA || ""; // ex: 5519

if (!MP_ACCESS_TOKEN) console.warn("⚠️ MP_ACCESS_TOKEN não definido em env.");
if (!GOOGLE_SCRIPT_URL) console.warn("⚠️ GOOGLE_SCRIPT_URL não definido em env.");
if (!WHATSAPP_BEA) console.warn("⚠️ WHATSAPP_BEA não definido em env.");

// Configurável
const CONFIG = {
  startHour: 9,
  endHour: 19,
  slotMinutes: 180, // duração do slot em minutos
};

// Em memória (para bloqueio instantâneo). Pode ser substituído por DB no futuro.
let agendamentos = []; // { data: "YYYY-MM-DD", horario: "HH:MM", servico, nome }

// --- Helpers ---
function isoToBR(isoDate) {
  if (!isoDate) return "";
  // aceita YYYY-MM-DD ou Date string
  try {
    const d = new Date(isoDate);
    if (!isNaN(d)) {
      return d.toLocaleDateString("pt-BR");
    }
    // fallback split
    const [y, m, day] = isoDate.split("-");
    if (day) return `${day}/${m}/${y}`;
    return isoDate;
  } catch {
    return isoDate;
  }
}

function buildWhatsAppLink({ nome, servico, diaBr, hora, extra = "" }) {
  const mensagem = `Oi Bea! 💅%0A%0ANovo agendamento confirmado:%0A👤 Cliente: ${encodeURIComponent(
    nome
  )}%0A📅 Data: ${encodeURIComponent(diaBr)}%0A⏰ Horário: ${encodeURIComponent(
    hora
  )}%0A💆 Serviço: ${encodeURIComponent(servico)}%0A${extra}`; // already encoded pieces
  return `https://wa.me/${WHATSAPP_BEA}?text=${mensagem}`;
}

async function postToGoogleScript(payload, tries = 2) {
  // tenta postar e retorna json (ou throw)
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
      console.error(`Erro ao postar no Google Script (attempt ${attempt}):`, err.message);
      if (attempt === tries) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

// --- ENDPOINTS ---

// Health
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// Horários disponíveis (query param "data" = "YYYY-MM-DD")
app.get("/horarios-disponiveis", (req, res) => {
  try {
    const data = req.query.data;
    if (!data) return res.status(400).json({ ok: false, msg: "Parâmetro data obrigatório (YYYY-MM-DD)" });

    const slots = [];
    for (let h = CONFIG.startHour; h < CONFIG.endHour; h += CONFIG.slotMinutes / 60) {
      const slot = `${String(h).padStart(2, "0")}:00`;
      const ocupado = agendamentos.find((a) => a.data === data && a.horario === slot);
      if (!ocupado) slots.push(slot);
    }

    return res.json({ ok: true, data, horarios: slots });
  } catch (err) {
    console.error("Erro /horarios-disponiveis:", err);
    return res.status(500).json({ ok: false, msg: err.message });
  }
});

// Criar preferência (gerar pagamento)
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;
    if (!nome || !servico || precoTotal == null || !diaagendado || !horaagendada) {
      return res.status(400).json({ ok: false, msg: "Campos obrigatórios ausentes" });
    }

    // Monta preference
    const preference = {
      items: [{ title: servico, quantity: 1, unit_price: parseFloat(precoTotal) }],
      payer: { name: nome },
      metadata: { nome, whatsapp, servico, diaagendada, horaagendada },
      back_urls: { success: "#", failure: "#", pending: "#" },
      auto_return: "approved",
      external_reference: `${nome}-${Date.now()}`,
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

    console.log("Preferência criada:", mpJson.id || mpJson);

    // link de whatsapp prefill (opcional): cliente já pode falar com Bea antes do pagamento se quiser
    const diaBr = isoToBR(diaagendado);
    const whatsapp_prefill = WHATSAPP_BEA
      ? buildWhatsAppLink({ nome, servico, diaBr, hora: horaagendada, extra: "%0A%0A(Enviei pelo site)" })
      : null;

    return res.json({ ok: true, preference: mpJson, init_point: mpJson.init_point, whatsapp_prefill });
  } catch (err) {
    console.error("Erro /gerar-pagamento:", err);
    return res.status(500).json({ ok: false, msg: err.message });
  }
});

// Webhook Mercado Pago (configure na conta do MP)
app.post("/webhook", async (req, res) => {
  try {
    console.log("Webhook recebido:", JSON.stringify(req.body).slice(0, 1000));
    const paymentId = req.body?.data?.id;
    if (!paymentId) {
      console.log("paymentId ausente no payload do webhook");
      return res.status(400).json({ ok: false, msg: "paymentId ausente" });
    }

    // Consulta pagamento
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });

    const payment = await mpRes.json();
    console.log("Detalhes do pagamento:", payment.status, payment.status_detail);

    if (payment.status === "approved") {
      // pega metadata (foi gravado na preferência)
      const meta = payment.metadata || {};
      const diaIso = meta.diaagendada || meta.diaagendado || "";
      const diaBR = isoToBR(diaIso);
      const hora = meta.horaagendada || meta.horaagendado || meta.hora || "";
      const nome = meta.nome || "";
      const servico = meta.servico || "";
      const whatsappCliente = meta.whatsapp || "";

      const agendamento = {
        nome,
        diaagendado: diaBR,
        horaagendada: hora,
        servico,
        valor30: payment.transaction_amount ? `R$ ${(payment.transaction_amount * 0.3).toFixed(2)}` : "",
        status: "Aprovado",
        whatsapp: whatsappCliente,
        transaction_id: payment.id,
        reference: payment.external_reference || "",
      };

      // Envia para Google Script (com retries)
      try {
        const scriptResp = await postToGoogleScript(agendamento, 3);
        console.log("Retorno Google Script:", scriptResp && scriptResp.json ? scriptResp.json : scriptResp);
      } catch (err) {
        console.error("Erro ao enviar para Google Script:", err.message);
      }

      // Bloqueia o horário na memória (YYYY-MM-DD)
      agendamentos.push({ data: diaIso, horario: hora, servico, nome });
      console.log("Horário bloqueado (cache):", diaIso, hora);

      // Gera link whatsapp para Bea com detalhes
      const waLink = WHATSAPP_BEA ? buildWhatsAppLink({ nome, servico, diaBr, hora }) : null;
      console.log("Link WhatsApp para Bea:", waLink);

      // opcional: aqui você pode chamar APIs para enviar notificações, telegram, etc.

      return res.status(200).json({ ok: true, msg: "Pagamento aprovado e processado", whatsapp_link: waLink });
    } else {
      console.log("Pagamento não aprovado:", payment.status);
      return res.status(200).json({ ok: false, msg: `Pagamento ${payment.status}` });
    }
  } catch (err) {
    console.error("Erro no webhook:", err);
    return res.status(500).json({ ok: false, msg: err.message });
  }
});

// --- START ---
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
