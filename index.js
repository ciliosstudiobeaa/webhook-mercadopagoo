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
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const WHATSAPP_BEA = process.env.WHATSAPP_BEA || "";

if (!MP_ACCESS_TOKEN) console.warn("⚠️ MP_ACCESS_TOKEN não definido em env.");
if (!GOOGLE_SCRIPT_URL) console.warn("⚠️ GOOGLE_SCRIPT_URL não definido em env.");
if (!WHATSAPP_BEA) console.warn("⚠️ WHATSAPP_BEA não definido em env.");

const CONFIG = { startHour: 9, endHour: 19, slotMinutes: 180 };
let agendamentos = []; // bloqueio de horários {data, horario, servico, nome}

// --- Helpers ---
function isoToBR(isoDate) {
  try {
    const [y, m, d] = isoDate.split("-");
    return `${d}/${m}/${y}`;
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
      console.log("✅ Google Script resposta:", json);
      return { ok: res.ok, json, status: res.status };
    } catch (err) {
      console.error(`❌ Google Script erro (tentativa ${attempt}):`, err.message);
      if (attempt === tries) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

// --- Endpoints ---
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// Horários disponíveis
app.get("/horarios-disponiveis", (req, res) => {
  const data = req.query.data;
  if (!data) return res.status(400).json({ ok: false, msg: "Parâmetro data obrigatório (YYYY-MM-DD)" });
  const slots = [];
  for (let h = CONFIG.startHour; h < CONFIG.endHour; h += CONFIG.slotMinutes / 60) {
    const slot = `${String(h).padStart(2, "0")}:00`;
    const ocupado = agendamentos.find((a) => a.data === data && a.horario === slot);
    if (!ocupado) slots.push(slot);
  }
  return res.json({ ok: true, data, horarios: slots });
});

// Criar preferência de pagamento
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;

    if (!nome || !servico || precoTotal == null || !diaagendado || !horaagendada)
      return res.status(400).json({ ok: false, msg: "Campos obrigatórios ausentes" });

    // Bloqueio imediato do horário
    const jaOcupado = agendamentos.find(a => a.data === diaagendado && a.horario === horaagendada);
    if (jaOcupado) return res.status(400).json({ ok:false, msg:"Horário já reservado" });
    agendamentos.push({ data: diaagendado, horario: horaagendada, servico, nome });

    console.log("⏱ Horário bloqueado:", diaagendado, horaagendada);

    const preference = {
      items: [{ title: servico, quantity: 1, unit_price: parseFloat(precoTotal) }],
      payer: { name: nome },
      metadata: { nome, whatsapp, servico, diaagendado, horaagendada },
      back_urls: { success:"#", failure:"#", pending:"#"},
      auto_return: "approved",
      external_reference: `${nome}-${Date.now()}`
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(preference),
    });
    const mpJson = await mpRes.json();
    console.log("✅ Preferência criada:", mpJson.id || mpJson);

    const diaBr = isoToBR(diaagendado);
    const whatsapp_link = buildWhatsAppLink({ nome, servico, diaBr, hora: horaagendada });

    return res.json({ ok: true, init_point: mpJson.init_point, whatsapp_link });
  } catch (err) {
    console.error("❌ Erro gerar-pagamento:", err);
    return res.status(500).json({ ok:false, msg:err.message });
  }
});

// --- START ---
app.listen(PORT, () => console.log(`🚀 Server rodando na porta ${PORT}`));
