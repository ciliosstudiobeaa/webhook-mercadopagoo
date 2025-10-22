import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

// --- Função para formatar data DD/MM/YYYY ---
function formatarDataBR(val) {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d)) return val;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const ano = d.getFullYear();
  return `${dia}/${mes}/${ano}`;
}

// --- Função para formatar hora HH:mm corrigida ---
function formatarHora(val) {
  if (!val) return "";
  // Se vier fração de dia (Sheets retorna número entre 0 e 1)
  if (typeof val === "number") {
    const totalMinutes = Math.round(val * 24 * 60); // minutos totais
    const h = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const m = String(totalMinutes % 60).padStart(2, "0");
    return `${h}:${m}`;
  }
  // Se já estiver em string HH:mm ou ISO, tenta extrair HH:mm
  if (typeof val === "string") {
    const match = val.match(/(\d{2}):(\d{2})/);
    if (match) return `${match[1]}:${match[2]}`;
  }
  return val;
}

// --- Rota horários bloqueados ---
app.get("/horarios-bloqueados", async (req, res) => {
  try {
    const response = await fetch(GOOGLE_SCRIPT_URL);
    const data = await response.json();

    // garante que dia/hora fiquem corretos
    const cleanData = data.map(x => ({
      Nome: x.Nome || x.nome || "",
      dia: formatarDataBR(x.dia || x.diaagendada || x.diaagendado),
      hora: formatarHora(x.hora || x.horaagendada),
      servico: x.servico || "",
      valor30: x.valor30 || 0,
      status: x.status || "",
      whatsapp: x.whatsapp || "",
      transaction_id: x.transaction_id || "",
      reference: x.reference || "",
    }));

    res.json(cleanData.filter(x => x.status === "Aprovado"));
  } catch (err) {
    console.error("Erro ao buscar horários:", err);
    res.status(500).json({ error: "Erro ao buscar horários" });
  }
});

// --- Rota gerar pagamento ---
app.post("/gerar-pagamento", async (req, res) => {
  const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;
  if (!nome || !whatsapp || !servico || !precoTotal || !diaagendado || !horaagendada) {
    return res.status(400).json({ error: "Campos obrigatórios faltando" });
  }
  try {
    const precoLimpo = parseFloat(String(precoTotal).replace(",", "."));
    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        items: [{ title: servico, quantity: 1, unit_price: precoLimpo }],
        back_urls: { success: "https://seusite.com/sucesso", pending: "", failure: "" },
        auto_return: "approved",
        external_reference: JSON.stringify({ nome, whatsapp, servico, precoTotal: precoLimpo, diaagendado, horaagendada }),
      }),
    });
    const mpJson = await mpRes.json();
    if (!mpJson.init_point) return res.status(500).json({ error: "Erro ao gerar pagamento MP", mpJson });
    res.json({ init_point: mpJson.init_point });
  } catch (e) {
    console.error("Erro ao gerar pagamento:", e);
    res.status(500).json({ error: "Erro interno" });
  }
});

// --- Webhook pagamento aprovado ---
app.post("/webhook", async (req, res) => {
  try {
    const { type, data } = req.body;
    if (type === "payment") {
      const paymentId = data.id;
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      });
      const mpData = await mpRes.json();
      if (mpData.status === "approved") {
        let externalRef = {};
        try { externalRef = JSON.parse(mpData.external_reference); } catch {}
        const nome = externalRef.nome || "";
        const whatsapp = externalRef.whatsapp || "";
        const servico = externalRef.servico || mpData.description || "";
        const diaagendado = formatarDataBR(externalRef.diaagendado || "");
        const horaagendada = externalRef.horaagendada || "";
        const status = "Aprovado";
        const valor30 = parseFloat(mpData.transaction_amount || externalRef.precoTotal || 0);
        const transaction_id = mpData.transaction_details?.transaction_id || "";
        const reference = paymentId || "";

        await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome, whatsapp, servico, diaagendado, horaagendada, status, valor30, transaction_id, reference }),
        });
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("Erro webhook MP:", err);
    res.sendStatus(500);
  }
});

// --- Status pagamento ---
app.get("/status-pagamento", async (req, res) => {
  try {
    const { transaction_id, reference } = req.query;
    if (!transaction_id && !reference) return res.status(400).json({ error: "transaction_id ou reference obrigatórios" });

    let mpRes;
    if (transaction_id) {
      mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${transaction_id}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      });
    } else {
      mpRes = await fetch(`https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      });
    }

    const mpData = await mpRes.json();
    let status = "";
    if (mpData.status) status = mpData.status;
    else if (mpData.results && mpData.results[0]) status = mpData.results[0].status;

    res.json({ status });
  } catch (err) {
    console.error("Erro ao consultar status do pagamento:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
