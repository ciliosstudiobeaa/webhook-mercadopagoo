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
  return isNaN(parsed) ? 0 : parsed;
}

// === FUNÇÃO PARA FORMATAR DATA BR ===
function formatarDataBR(dataISO) {
  if (!dataISO) return "";
  const partes = dataISO.split("-");
  if (partes.length !== 3) return dataISO;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

// === ROTA PARA HORÁRIOS BLOQUEADOS ===
app.get("/horarios-bloqueados", async (req, res) => {
  try {
    console.log("Buscando horários bloqueados...");
    const response = await fetch(GOOGLE_SCRIPT_URL);
    const data = await response.json();
    const approved = data.filter(x => x.status === "Aprovado");
    console.log("Horários aprovados:", approved);
    res.json(approved);
  } catch (e) {
    console.error("Erro ao buscar horários:", e);
    res.status(500).json({ error: "Erro ao buscar horários" });
  }
});

// === ROTA PARA GERAR PAGAMENTO COM LOGS ===
app.post("/gerar-pagamento", async (req, res) => {
  const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;

  console.log("Recebido pedido de pagamento:", req.body);

  if (!nome || !whatsapp || !servico || !precoTotal || !diaagendado || !horaagendada) {
    console.error("Campos obrigatórios faltando");
    return res.status(400).json({ error: "Campos obrigatórios faltando" });
  }

  try {
    const precoLimpo = limparValor(precoTotal);
    console.log("Preço limpo:", precoLimpo);

    const externalRef = { nome, whatsapp, servico, precoTotal: precoLimpo, diaagendado, horaagendada };
    console.log("External reference enviado ao MP:", externalRef);

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
        external_reference: JSON.stringify(externalRef),
      }),
    });

    const mpJson = await mpRes.json();
    console.log("Resposta do MP:", mpJson);

    if (!mpJson.init_point) {
      console.error("Erro ao gerar init_point do MP");
      return res.status(500).json({ error: "Erro ao gerar pagamento MP", mpJson });
    }

    res.json({ init_point: mpJson.init_point });
  } catch (e) {
    console.error("Erro ao gerar pagamento:", e);
    res.status(500).json({ error: "Erro interno" });
  }
});

// === WEBHOOK PARA PAGAMENTO APROVADO COM LOGS ===
app.post("/webhook", async (req, res) => {
  try {
    const { type, data } = req.body;

    console.log("=== WEBHOOK RECEBIDO ===");
    console.log("Tipo:", type);
    console.log("Dados brutos:", JSON.stringify(data, null, 2));

    if (type === "payment") {
      const paymentId = data.id;
      console.log("Payment ID:", paymentId);

      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      });
      const mpData = await mpRes.json();
      console.log("Dados do pagamento MP:", JSON.stringify(mpData, null, 2));

      if (mpData.status === "approved") {
        let externalRef = {};
        try {
          console.log("External reference raw:", mpData.external_reference);
          externalRef = JSON.parse(mpData.external_reference);
        } catch (e) {
          console.error("Erro ao parsear external_reference:", e);
        }

        const nome = externalRef.nome || "";
        const whatsapp = externalRef.whatsapp || "";
        const servico = externalRef.servico || mpData.description || "";
        const diaagendado = formatarDataBR(externalRef.diaagendado || "");
        const horaagendada = externalRef.horaagendada || "";
        const status = "Aprovado";
        const valor30 = limparValor(mpData.transaction_amount || externalRef.precoTotal);
        const transaction_id = mpData.transaction_details?.transaction_id || "";
        const reference = paymentId || "";

        console.log("Campos que serão enviados para planilha:", { nome, whatsapp, servico, diaagendado, horaagendada, status, valor30, transaction_id, reference });

        const response = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome, whatsapp, servico, diaagendado, horaagendada, status, valor30, transaction_id, reference }),
        });

        const text = await response.text();
        console.log("Resposta crua do Google Script:", text);

        let result;
        try {
          result = JSON.parse(text);
        } catch (e) {
          console.error("Erro ao parsear resposta do Google Script:", e);
          result = {};
        }
        console.log("Resultado parseado do Google Script:", result);
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
    let status = "";
    if (mpData.status) status = mpData.status;
    else if (mpData.results && mpData.results[0]) status = mpData.results[0].status;

    console.log("Status consultado:", status);
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
