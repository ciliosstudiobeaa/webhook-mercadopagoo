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

console.log("🚀 Variáveis de ambiente:");
console.log({ MP_ACCESS_TOKEN, GOOGLE_SCRIPT_URL, WHATSAPP_BEA });

// --- Helpers ---
function isoToBR(isoDate) {
  if (!isoDate) return "";
  try {
    const d = new Date(isoDate);
    if (!isNaN(d)) return d.toLocaleDateString("pt-BR");
    const [y, m, day] = isoDate.split("-");
    if (day) return `${day}/${m}/${y}`;
    return isoDate;
  } catch (err) {
    console.error("Erro isoToBR:", err);
    return isoDate;
  }
}

function buildWhatsAppLink({ nome, servico, diaBr, hora }) {
  try {
    const msg = `Oi Bea! 💅%0A%0ANovo agendamento confirmado:%0A👤 Cliente: ${encodeURIComponent(nome)}%0A📅 Data: ${encodeURIComponent(diaBr)}%0A⏰ Horário: ${encodeURIComponent(hora)}%0A💆 Serviço: ${encodeURIComponent(servico)}`;
    return `https://wa.me/${WHATSAPP_BEA}?text=${msg}`;
  } catch (err) {
    console.error("Erro buildWhatsAppLink:", err);
    return null;
  }
}

async function postToGoogleScript(payload) {
  try {
    console.log("📤 Enviando para Google Script:", payload);
    const res = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    console.log("✅ Retorno Google Script:", json);
    return json;
  } catch (err) {
    console.error("❌ Erro postToGoogleScript:", err);
    throw err;
  }
}

// --- ENDPOINTS ---
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

app.post("/gerar-pagamento", async (req, res) => {
  try {
    console.log("📥 /gerar-pagamento req.body:", req.body);
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;
    if (!nome || !servico || precoTotal == null || !diaagendado || !horaagendada) {
      console.error("❌ Campos obrigatórios ausentes:", req.body);
      return res.status(400).json({ ok: false, msg: "Campos obrigatórios ausentes" });
    }

    const preference = {
      items: [{ title: servico, quantity: 1, unit_price: parseFloat(precoTotal) }],
      payer: { name: nome },
      metadata: { nome, whatsapp, servico, diaagendada: diaagendado, horaagendada },
      back_urls: { success: "#", failure: "#", pending: "#" },
      auto_return: "approved",
      external_reference: `${nome}-${Date.now()}`
    };

    console.log("📤 Criando preferência MP:", preference);

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(preference)
    });
    const mpJson = await mpRes.json();

    console.log("✅ Preferência criada:", mpJson);

    return res.json({ ok: true, init_point: mpJson.init_point });
  } catch (err) {
    console.error("❌ Erro /gerar-pagamento:", err);
    return res.status(500).json({ ok: false, msg: err.message });
  }
});

app.post("/webhook", async (req, res) => {
  try {
    console.log("📥 Webhook recebido:", JSON.stringify(req.body, null, 2));
    const paymentId = req.body?.data?.id;
    if (!paymentId) {
      console.error("❌ paymentId ausente no webhook");
      return res.status(400).json({ ok: false, msg: "paymentId ausente" });
    }

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const payment = await mpRes.json();
    console.log("📦 Detalhes do pagamento:", payment);

    if (payment.status === "approved") {
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
        valor: payment.transaction_amount ? `R$ ${payment.transaction_amount.toFixed(2)}` : "",
        status: "Aprovado",
        whatsapp: whatsappCliente,
        transaction_id: payment.id,
        reference: payment.external_reference || "",
      };

      try {
        const scriptResp = await postToGoogleScript(agendamento);
        console.log("✅ Google Script retornou:", scriptResp);
      } catch (err) {
        console.error("❌ Falha ao enviar para Google Script:", err);
      }

      const waLink = buildWhatsAppLink({ nome, servico, diaBr, hora });
      console.log("🔗 Link WhatsApp gerado:", waLink);

      return res.status(200).json({ ok: true, msg: "Pagamento aprovado e processado", whatsapp_link: waLink });
    } else {
      console.warn("⚠️ Pagamento não aprovado:", payment.status, payment.status_detail);
      return res.status(200).json({ ok: false, msg: `Pagamento ${payment.status}` });
    }
  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    return res.status(500).json({ ok: false, msg: err.message });
  }
});

// --- START ---
app.listen(PORT, () => console.log(`🚀 Server rodando na porta ${PORT}`));
