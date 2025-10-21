import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// === VARIÁVEIS DE AMBIENTE ===
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

// === FUNÇÃO PARA LIMPAR E CONVERTER VALOR EM NÚMERO ===
function limparValor(valor) {
  if (!valor) return 0;
  let num = String(valor).replace(/[^\d.,]/g, "");
  num = num.replace(",", ".");
  const parsed = parseFloat(num);
  console.log("Valor original:", valor, "→ valor limpo:", parsed);
  return isNaN(parsed) ? 0 : parsed;
}

// === FUNÇÃO PARA FORMATAR DATA BR FLEXÍVEL ===
function formatarDataBR(data) {
  if (!data) return "";
  
  // Detecta se é no formato americano MM/DD/YYYY
  if (data.includes("/")) {
    const [month, day, year] = data.split("/");
    if (day && month && year) return `${day}/${month}/${year}`;
  }
  
  // Assume ISO YYYY-MM-DD
  if (data.includes("-")) {
    const [year, month, day] = data.split("-");
    if (day && month && year) return `${day}/${month}/${year}`;
  }
  
  return data; // se não reconheceu, retorna original
}

// === ROTA PARA HORÁRIOS BLOQUEADOS ===
app.get("/horarios-bloqueados", async (req, res) => {
  try {
    const date = req.query.date; // Espera DD/MM/YYYY
    if (!date) return res.status(400).json({ error: "Parâmetro date é obrigatório" });

    console.log("Buscando horários bloqueados para:", date);
    const response = await fetch(GOOGLE_SCRIPT_URL);
    const data = await response.json();

    // Filtra somente os aprovados e da data solicitada
    const approved = data.filter(
      x => x.status.toLowerCase() === "aprovado" && x.diaagendado === date
    );

    console.log("Horários aprovados para", date, ":", approved);
    res.json(approved);
  } catch (e) {
    console.error("Erro ao buscar horários:", e);
    res.status(500).json({ error: "Erro ao buscar horários" });
  }
});

// === ROTA PARA GERAR PAGAMENTO ===
app.post("/gerar-pagamento", async (req, res) => {
  const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;

  console.log("Recebido para gerar pagamento:", req.body);

  if (!nome || !whatsapp || !servico || !precoTotal || !diaagendado || !horaagendada) {
    return res.status(400).json({ error: "Campos obrigatórios faltando" });
  }

  try {
    const precoLimpo = limparValor(precoTotal);

    if (precoLimpo <= 0) {
      return res.status(400).json({ error: "Valor inválido para pagamento" });
    }

    const bodyPreference = {
      items: [{ title: servico, quantity: 1, unit_price: precoLimpo }],
      back_urls: { success: "https://seusite.com/sucesso", pending: "", failure: "" },
      auto_return: "approved",
      external_reference: JSON.stringify({ nome, whatsapp, servico, precoTotal: precoLimpo, diaagendado, horaagendada }),
    };

    console.log("Enviando preferência para Mercado Pago:", bodyPreference);

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(bodyPreference),
    });

    const mpJson = await mpRes.json();
    console.log("Resposta do Mercado Pago:", mpJson);

    if (!mpJson.init_point) {
      return res.status(500).json({ error: "Erro ao gerar pagamento MP", mpJson });
    }

    res.json({ init_point: mpJson.init_point });
  } catch (e) {
    console.error("Erro ao gerar pagamento:", e);
    res.status(500).json({ error: "Erro interno" });
  }
});

// === WEBHOOK PARA PAGAMENTO APROVADO ===
app.post("/webhook", async (req, res) => {
  try {
    console.log("Recebido webhook MP:", req.body);
    const { type, data } = req.body;

    if (type === "payment") {
      const paymentId = data.id;

      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      });
      const mpData = await mpRes.json();
      console.log("Detalhes do pagamento:", mpData);

      if (mpData.status === "approved") {
        let externalRef = {};
        try { externalRef = JSON.parse(mpData.external_reference); } catch { console.log("External reference não é JSON"); }

        const nome = externalRef.nome || "";
        const whatsapp = externalRef.whatsapp || "";
        const servico = externalRef.servico || mpData.description || "";
        const diaagendado = formatarDataBR(externalRef.diaagendado || "");
        const horaagendada = externalRef.horaagendada || "";
        const status = "Aprovado";
        const valor30 = limparValor(mpData.transaction_amount || externalRef.precoTotal);
        const transaction_id = mpData.transaction_details?.transaction_id || "";
        const reference = paymentId || "";

        // --- Envio para planilha ---
        const response = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome, whatsapp, servico, diaagendado, horaagendada, status, valor30, transaction_id, reference }),
        });
        const result = await response.json().catch(() => ({}));
        console.log("Envio para planilha:", result);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro webhook MP:", err);
    res.sendStatus(500);
  }
});

// === CONSULTAR STATUS DO PAGAMENTO ===
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
    console.log("Status retornado pelo MP:", mpData);

    let status = "";
    if (mpData.status) status = mpData.status;
    else if (mpData.results && mpData.results[0]) status = mpData.results[0].status;

    res.json({ status });
  } catch (err) {
    console.error("Erro ao consultar status do pagamento:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// === ROTA DE PING ===
app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

// === START SERVER ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
