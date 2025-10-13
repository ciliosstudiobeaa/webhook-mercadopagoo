import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURAÇÕES ---
const CONFIG = {
  startHour: 9,
  endHour: 19,
  slotMinutes: 180,
};

let agendamentos = []; // armazenará os horários ocupados localmente

// Função utilitária para formatar datas no formato brasileiro
function formatarDataBR(isoDate) {
  if (!isoDate) return "";
  const [ano, mes, dia] = isoDate.split("-");
  return `${dia}/${mes}/${ano}`;
}

// --- ENDPOINT: Horários disponíveis ---
app.get("/horarios-disponiveis", async (req, res) => {
  try {
    const { data } = req.query;
    if (!data) return res.status(400).json({ ok: false, msg: "Data não informada" });

    const horarios = [];
    for (let h = CONFIG.startHour; h < CONFIG.endHour; h += CONFIG.slotMinutes / 60) {
      const slot = `${String(h).padStart(2, "0")}:00`;
      const ocupado = agendamentos.find(
        (a) => a.data === data && a.horario === slot
      );
      if (!ocupado) horarios.push(slot);
    }

    res.json({ ok: true, horarios });
  } catch (err) {
    console.error("Erro /horarios-disponiveis:", err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// --- ENDPOINT: Gerar pagamento ---
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;

    if (!nome || !whatsapp || !servico || !precoTotal || !diaagendado || !horaagendada) {
      return res.status(400).json({ ok: false, msg: "Campos obrigatórios ausentes" });
    }

    const preference = {
      items: [
        {
          title: servico,
          quantity: 1,
          unit_price: parseFloat(precoTotal),
        },
      ],
      payer: { name: nome },
      metadata: { nome, whatsapp, servico, diaagendada, horaagendada },
      back_urls: {
        success: "https://seusite.com/sucesso",
        failure: "https://seusite.com/falha",
      },
      auto_return: "approved",
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(preference),
    });

    const mpJson = await mpRes.json();
    console.log("✅ Preferência criada:", mpJson.id);
    res.json(mpJson);
  } catch (err) {
    console.error("Erro /gerar-pagamento:", err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// --- ENDPOINT: Webhook Mercado Pago ---
app.post("/webhook", async (req, res) => {
  try {
    const paymentId = req.body.data?.id;
    if (!paymentId) {
      console.log("❌ paymentId ausente no webhook");
      return res.status(400).json({ ok: false, msg: "paymentId ausente" });
    }

    console.log("🔎 Consultando pagamento:", paymentId);

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });
    const payment = await mpRes.json();

    console.log("📦 Detalhes do pagamento:", payment.status, payment.status_detail);

    if (payment.status === "approved") {
      console.log("✅ Pagamento aprovado! Enviando ao Google Script...");

      const agendamento = {
        nome: payment.metadata?.nome || "",
        diaagendado: formatarDataBR(payment.metadata?.diaagendada),
        horaagendada: payment.metadata?.horaagendada || "",
        servico: payment.metadata?.servico || "",
        valor30: payment.transaction_amount
          ? `R$ ${(payment.transaction_amount * 0.3).toFixed(2)}`
          : "",
        status: "Aprovado",
        whatsapp: payment.metadata?.whatsapp || "",
        transaction_id: payment.id || "",
        reference: payment.external_reference || "",
      };

      const scriptRes = await fetch(process.env.GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agendamento),
      });

      const scriptData = await scriptRes.json();
      console.log("📤 Retorno Google Script:", scriptData);

      // Bloqueia o horário
      agendamentos.push({
        data: payment.metadata?.diaagendada,
        horario: payment.metadata?.horaagendada,
      });

      console.log("🗓️ Horário bloqueado:", payment.metadata?.diaagendada, payment.metadata?.horaagendada);
    } else {
      console.log("ℹ️ Pagamento não aprovado:", payment.status);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// --- SERVER ON ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
